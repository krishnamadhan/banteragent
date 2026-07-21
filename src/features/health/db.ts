// Health feature — Supabase CRUD layer (AB-079)
// All inserts are idempotent on source_message_id.
// Corrections create a new event with supersedes_id + soft-delete the old one.
// Never hard-delete; never expose service key.

import { supabase } from "../../supabase.js";
import type {
  PersonKey, HealthEvent, HealthProfile, DailyAggregate, FoodParseResult, ConfidenceTier, DayStatus,
} from "./types.js";

// ── Events ────────────────────────────────────────────────────────────────────────

/** Insert a health event. Returns existing id if source_message_id already exists (idempotent). */
export async function insertHealthEvent(event: Omit<HealthEvent, "id">): Promise<string | null> {
  const { data: existing } = await supabase
    .from("ba_health_events")
    .select("id")
    .eq("source_message_id", event.source_message_id)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from("ba_health_events")
    .insert({
      person:              event.person,
      type:                event.type,
      occurred_at:         event.occurred_at,
      logged_at:           event.logged_at,
      timezone:            event.timezone,
      source_message_id:   event.source_message_id,
      source_type:         event.source_type,
      payload:             event.payload,
      attribution_method:  event.attribution_method,
      confidence:          event.confidence,
      est_low:             event.est_low,
      est_high:            event.est_high,
      model_version:       event.model_version,
      nutrition_reference: event.nutrition_reference,
      supersedes_id:       event.supersedes_id,
      deleted_at:          null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[health:db] insertHealthEvent error:", error.message);
    return null;
  }
  await auditLog(event.person, "insert_event", data.id, { type: event.type, source: event.source_type });
  return data.id as string;
}

/** Correct an event: soft-delete old, insert new with supersedes_id reference. */
export async function correctHealthEvent(
  supersededId: string,
  correctionEvent: Omit<HealthEvent, "id" | "supersedes_id">,
): Promise<string | null> {
  const now = new Date().toISOString();

  await supabase
    .from("ba_health_events")
    .update({ deleted_at: now })
    .eq("id", supersededId);

  const newId = await insertHealthEvent({ ...correctionEvent, supersedes_id: supersededId });
  if (newId) {
    await auditLog(correctionEvent.person, "correct_event", newId, { supersedes_id: supersededId });
  }
  return newId;
}

/** Get today's food events for a person (IST date). */
export async function getTodayFoodEvents(person: PersonKey, dateIST: string): Promise<HealthEvent[]> {
  const from = `${dateIST}T00:00:00+05:30`;
  const to   = `${dateIST}T23:59:59+05:30`;
  const { data } = await supabase
    .from("ba_health_events")
    .select("*")
    .eq("person", person)
    .eq("type", "food")
    .is("deleted_at", null)
    .gte("occurred_at", from)
    .lte("occurred_at", to)
    .order("occurred_at", { ascending: true });
  return (data ?? []) as HealthEvent[];
}

/** Get latest weight events for trend calculation (up to N days back). */
export async function getWeightHistory(person: PersonKey, daysBack: number): Promise<Array<{ occurred_at: string; payload: Record<string, unknown> }>> {
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("ba_health_events")
    .select("occurred_at, payload")
    .eq("person", person)
    .eq("type", "weight")
    .is("deleted_at", null)
    .gte("occurred_at", from)
    .order("occurred_at", { ascending: true });
  return (data ?? []) as Array<{ occurred_at: string; payload: Record<string, unknown> }>;
}

// ── Profiles ──────────────────────────────────────────────────────────────────────

export async function getHealthProfile(person: PersonKey): Promise<HealthProfile | null> {
  const { data } = await supabase
    .from("ba_health_profile")
    .select("*")
    .eq("person", person)
    .maybeSingle();
  return data as HealthProfile | null;
}

export async function upsertHealthProfile(person: PersonKey, profile: Partial<HealthProfile>): Promise<boolean> {
  const { error } = await supabase
    .from("ba_health_profile")
    .upsert({ person, ...profile, updated_at: new Date().toISOString() }, { onConflict: "person" });
  if (error) {
    console.error("[health:db] upsertHealthProfile error:", error.message);
    return false;
  }
  await auditLog(person, "upsert_profile", null, { fields: Object.keys(profile) });
  return true;
}

/** Check if person has accepted consent. */
export async function hasConsent(person: PersonKey): Promise<boolean> {
  const profile = await getHealthProfile(person);
  const consent = profile?.consent as unknown as Record<string, unknown> | undefined;
  return consent?.accepted === true;
}

/** Check if person needs onboarding (no profile or consent not accepted). */
export async function needsOnboarding(person: PersonKey): Promise<"consent" | "safety_screen" | "profile" | null> {
  const profile = await getHealthProfile(person);
  if (!profile) return "consent";
  const consent = profile.consent as unknown as Record<string, unknown>;
  if (!consent?.accepted) return "consent";
  const screenRaw = (profile as unknown as Record<string, unknown>).screen_flags;
  const screen = screenRaw as Record<string, unknown> | undefined;
  if (!screen?.screened) return "safety_screen";
  if (!profile.age || !profile.height_cm || !profile.weight_kg) return "profile";
  return null;
}

// ── Food cache ────────────────────────────────────────────────────────────────────

export interface CachedFood {
  id: string;
  dish: string;
  est_kcal_per_portion: number;
  est_kcal_low: number;
  est_kcal_high: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  nutrition_source: string;
  user_correction_count: number;
}

export async function lookupFoodCache(dish: string): Promise<CachedFood | null> {
  const { data } = await supabase
    .from("ba_health_food_cache")
    .select("*")
    .ilike("dish", dish.trim())
    .order("user_correction_count", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as CachedFood | null;
}

export async function upsertFoodCache(
  dish: string,
  macros: { est_kcal: number; est_low: number; est_high: number; protein_g: number; carbs_g: number; fat_g: number },
  source: string,
  isUserCorrection = false,
): Promise<void> {
  const { data: existing } = await supabase
    .from("ba_health_food_cache")
    .select("id, user_correction_count")
    .ilike("dish", dish.trim())
    .maybeSingle();

  if (existing) {
    await supabase
      .from("ba_health_food_cache")
      .update({
        est_kcal_per_portion: macros.est_kcal,
        est_kcal_low: macros.est_low,
        est_kcal_high: macros.est_high,
        protein_g: macros.protein_g,
        carbs_g: macros.carbs_g,
        fat_g: macros.fat_g,
        nutrition_source: source,
        user_correction_count: (existing.user_correction_count ?? 0) + (isUserCorrection ? 1 : 0),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("ba_health_food_cache")
      .insert({
        dish: dish.trim(),
        est_kcal_per_portion: macros.est_kcal,
        est_kcal_low: macros.est_low,
        est_kcal_high: macros.est_high,
        protein_g: macros.protein_g,
        carbs_g: macros.carbs_g,
        fat_g: macros.fat_g,
        nutrition_source: source,
        user_correction_count: isUserCorrection ? 1 : 0,
      });
  }
}

// ── Daily aggregates ──────────────────────────────────────────────────────────────

export async function getDailyAggregate(person: PersonKey, dateIST: string): Promise<DailyAggregate | null> {
  const { data } = await supabase
    .from("ba_health_daily")
    .select("*")
    .eq("person", person)
    .eq("date", dateIST)
    .maybeSingle();
  return data as DailyAggregate | null;
}

/** Recompute and store the daily aggregate from raw events. Deterministic. */
export async function recomputeDailyAggregate(person: PersonKey, dateIST: string, profile: HealthProfile): Promise<DailyAggregate> {
  const foodEvents = await getTodayFoodEvents(person, dateIST);
  const from = `${dateIST}T00:00:00+05:30`;
  const to   = `${dateIST}T23:59:59+05:30`;

  const { data: metricEvents } = await supabase
    .from("ba_health_events")
    .select("type, payload")
    .eq("person", person)
    .is("deleted_at", null)
    .in("type", ["weight", "sleep", "steps", "workout", "water"])
    .gte("occurred_at", from)
    .lte("occurred_at", to);

  let kcalLow = 0, kcalHigh = 0, protein = 0, steps = 0, sleepHrs = 0, waterMl = 0;

  for (const ev of foodEvents) {
    const p = ev.payload as Record<string, unknown>;
    kcalLow  += Number(p.total_est_kcal_low  ?? p.est_kcal_low  ?? 0);
    kcalHigh += Number(p.total_est_kcal_high ?? p.est_kcal_high ?? 0);
    protein  += Number(p.total_protein_g     ?? 0);
  }

  for (const ev of (metricEvents ?? [])) {
    const p = ev.payload as Record<string, unknown>;
    if (ev.type === "steps")   steps    = Math.max(steps,    Number(p.steps    ?? 0));
    if (ev.type === "sleep")   sleepHrs = Math.max(sleepHrs, Number(p.hours    ?? 0));
    if (ev.type === "water")   waterMl += Number(p.ml ?? 0);
    if (ev.type === "workout") steps   += Math.round(Number(p.minutes ?? 0) * 100); // approximate
  }

  const agg = computeStatuses({ kcalLow, kcalHigh, protein, steps, sleepHrs, waterMl }, profile);

  await supabase
    .from("ba_health_daily")
    .upsert({
      person,
      date: dateIST,
      est_kcal_low:      kcalLow,
      est_kcal_high:     kcalHigh,
      protein_g:         protein,
      steps,
      sleep_hours:       sleepHrs,
      water_ml:          waterMl,
      nutrition_status:  agg.nutrition_status,
      protein_status:    agg.protein_status,
      movement_status:   agg.movement_status,
      sleep_status:      agg.sleep_status,
      hydration_status:  agg.hydration_status,
      top_action:        agg.top_action,
      recomputed_at:     new Date().toISOString(),
    }, { onConflict: "person,date" });

  return { person, date: dateIST, est_kcal_low: kcalLow, est_kcal_high: kcalHigh, protein_g: protein, steps, sleep_hours: sleepHrs, water_ml: waterMl, ...agg };
}

function computeStatuses(
  vals: { kcalLow: number; kcalHigh: number; protein: number; steps: number; sleepHrs: number; waterMl: number },
  profile: HealthProfile,
): Pick<DailyAggregate, "nutrition_status" | "protein_status" | "movement_status" | "sleep_status" | "hydration_status" | "top_action"> {
  const { kcalLow, kcalHigh, protein, steps, sleepHrs, waterMl } = vals;

  const kcalMid = (kcalLow + kcalHigh) / 2;
  const kcalTargetMid = (profile.calorie_target_low + profile.calorie_target_high) / 2;

  const nutritionStatus: DayStatus = kcalMid === 0 ? "unknown"
    : kcalMid >= profile.calorie_target_low * 0.85 && kcalMid <= profile.calorie_target_high * 1.1 ? "on-track"
    : kcalMid < profile.calorie_target_low * 0.7 ? "low"
    : "needs-attention";

  const proteinStatus: DayStatus = protein === 0 ? "unknown"
    : protein >= profile.protein_target_low_g ? "on-track"
    : protein >= profile.protein_target_low_g * 0.75 ? "needs-attention"
    : "low";

  const movementStatus: DayStatus = steps === 0 ? "unknown"
    : steps >= 8000 ? "on-track"
    : steps >= 5000 ? "needs-attention"
    : "low";

  const sleepStatus: DayStatus = sleepHrs === 0 ? "unknown"
    : sleepHrs >= 7 ? "on-track"
    : sleepHrs >= 6 ? "needs-attention"
    : "low";

  const hydrationStatus: DayStatus = waterMl === 0 ? "unknown"
    : waterMl >= (profile.water_target_ml ?? 2500) * 0.9 ? "on-track"
    : waterMl >= (profile.water_target_ml ?? 2500) * 0.6 ? "needs-attention"
    : "low";

  const statuses = { nutrition_status: nutritionStatus, protein_status: proteinStatus, movement_status: movementStatus, sleep_status: sleepStatus, hydration_status: hydrationStatus };
  const top_action = pickTopAction(statuses, vals, profile, kcalTargetMid);

  return { ...statuses, top_action };
}

function pickTopAction(
  s: { nutrition_status: DayStatus; protein_status: DayStatus; movement_status: DayStatus; sleep_status: DayStatus; hydration_status: DayStatus },
  vals: { kcalLow: number; kcalHigh: number; protein: number; steps: number; sleepHrs: number; waterMl: number },
  profile: HealthProfile,
  kcalTargetMid: number,
): string {
  if (s.sleep_status === "low")
    return `Aim for at least 7 hours tonight — sleep powers recovery.`;
  if (s.protein_status === "low")
    return `Protein is low (${Math.round(vals.protein)}g/${Math.round(profile.protein_target_low_g)}g target). Add an egg, paneer, or dal before bed.`;
  if (s.hydration_status === "low")
    return `Hydration is low — try to reach ${Math.round((profile.water_target_ml ?? 2500) / 1000 * 10) / 10}L today.`;
  if (s.nutrition_status === "low")
    return `Calorie intake is low (~${Math.round(vals.kcalLow)}–${Math.round(vals.kcalHigh)} kcal). Don't skip dinner.`;
  if (s.movement_status === "low" || s.movement_status === "needs-attention")
    return `Add a short walk — even 20 minutes helps close your movement gap.`;
  if (s.protein_status === "needs-attention")
    return `Boost protein with your next meal to hit your ${Math.round(profile.protein_target_low_g)}g goal.`;
  return `Good progress today — keep the consistency going.`;
}

// ── Export / delete ───────────────────────────────────────────────────────────────

export async function exportPersonData(person: PersonKey): Promise<Record<string, unknown>> {
  const [events, profile, daily] = await Promise.all([
    supabase.from("ba_health_events").select("*").eq("person", person).is("deleted_at", null).order("occurred_at", { ascending: true }),
    supabase.from("ba_health_profile").select("*").eq("person", person).maybeSingle(),
    supabase.from("ba_health_daily").select("*").eq("person", person).order("date", { ascending: true }),
  ]);
  return {
    exported_at: new Date().toISOString(),
    person,
    profile: profile.data,
    events: events.data ?? [],
    daily_aggregates: daily.data ?? [],
  };
}

export async function softDeletePersonData(person: PersonKey): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("ba_health_events")
    .update({ deleted_at: now })
    .eq("person", person)
    .is("deleted_at", null);
  await auditLog(person, "soft_delete_all", null, { deleted_at: now });
}

// ── Audit log ─────────────────────────────────────────────────────────────────────

async function auditLog(person: string, action: string, eventId: string | null, details: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from("ba_health_audit").insert({ person, action, event_id: eventId, details });
  } catch { /* audit log failure is non-fatal */ }
}
