// Health feature — command handlers (AB-083)
// Full-word canonical commands + short aliases.
// Every write echoes a compact receipt.

import Anthropic from "@anthropic-ai/sdk";
import type { PersonKey, ParsedMetric, HealthProfile } from "./types.js";
import { getHealthProfile, upsertHealthProfile, insertHealthEvent, correctHealthEvent, getTodayFoodEvents, exportPersonData, softDeletePersonData, getWeightHistory } from "./db.js";
import { parseMetric, parseUndoRequest, parseEditRequest, needsConfirmation, plausibilityWarning } from "./parsers.js";
import { formatMetricReceipt, formatWeightReceipt, buildCoachAnswerPrompt } from "./healthPrompts.js";
import { computeTargets, computeWeightTrend } from "./engine.js";
import { ONBOARDING_COMPLETE } from "./consent.js";
import { PROFILE_PARSE_SYSTEM_PROMPT } from "./healthPrompts.js";
import { applyCorrectionToCache } from "./food.js";

const anthropic = new Anthropic();

// ── IST helpers ───────────────────────────────────────────────────────────────────

function istNow(): string {
  return new Date().toISOString();
}

function istDateStr(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── Metric log handler ────────────────────────────────────────────────────────────

export async function handleMetricLog(
  person: PersonKey,
  text: string,
  messageId: string,
  occurredAt: string = istNow(),
): Promise<string> {
  const metric = parseMetric(text);
  if (!metric) return "Couldn't parse that metric. Try: `!weight 74.2` · `!sleep 7h` · `!steps 8300` · `!water 2L` · `!workout 40 min badminton`";

  // Plausibility gate
  if (!metric.value || metric.value <= 0) return `Value must be positive.`;
  if (needsConfirmation(metric.type, metric.value)) {
    return `⚠️ ${plausibilityWarning(metric.type, metric.value)}\nReply *!confirm* to log it, or correct the value.`;
  }

  const profile = await getHealthProfile(person);
  return await saveMetric(person, metric, messageId, occurredAt, profile);
}

async function saveMetric(
  person: PersonKey,
  metric: ParsedMetric,
  messageId: string,
  occurredAt: string,
  profile: HealthProfile | null,
): Promise<string> {
  const eventId = await insertHealthEvent({
    person,
    type: metric.type,
    occurred_at: occurredAt,
    logged_at: istNow(),
    timezone: "Asia/Kolkata",
    source_message_id: messageId,
    source_type: "command",
    payload: { [metric.type === "weight" ? "weight_kg" : metric.unit ?? metric.type]: metric.value, ...(metric.extra ?? {}) },
    attribution_method: "sender",
    confidence: "high",
    est_low: metric.type === "weight" ? metric.value : null,
    est_high: metric.type === "weight" ? metric.value : null,
    model_version: null,
    nutrition_reference: null,
    supersedes_id: null,
    deleted_at: null,
  });

  if (!eventId) return "❌ Failed to save. Please try again.";

  if (metric.type === "weight") {
    const history = await getWeightHistory(person, 30);
    const trend = computeWeightTrend(history.map(h => ({
      occurred_at: h.occurred_at,
      weight_kg: Number((h.payload as Record<string, unknown>).weight_kg ?? metric.value),
    })));
    const trendStr = trend.trend_direction !== "insufficient_data" && trend.weekly_change_kg !== null
      ? `${trend.trend_direction} ~${Math.abs(trend.weekly_change_kg)}kg/wk`
      : null;
    return formatWeightReceipt(person, metric.value, trendStr);
  }

  const valueStr = metric.type === "sleep"   ? `${metric.value}h`
    : metric.type === "water"   ? `${metric.value}ml`
    : metric.type === "steps"   ? `${metric.value.toLocaleString()} steps`
    : metric.type === "workout" ? `${metric.value} min${metric.extra?.activity ? " " + metric.extra.activity : ""}`
    : String(metric.value);

  return formatMetricReceipt(metric.type, valueStr, person);
}

// ── Undo last event ───────────────────────────────────────────────────────────────

export async function handleUndo(person: PersonKey, messageId: string): Promise<string> {
  const today = istDateStr();
  const events = await getTodayFoodEvents(person, today);
  if (!events.length) return "Nothing to undo from today.";

  const last = events[events.length - 1]!;
  await correctHealthEvent(last.id!, {
    person,
    type: last.type,
    occurred_at: last.occurred_at,
    logged_at: istNow(),
    timezone: "Asia/Kolkata",
    source_message_id: messageId + "_undo",
    source_type: "command",
    payload: { ...last.payload, _undo: true },
    attribution_method: last.attribution_method,
    confidence: null,
    est_low: null,
    est_high: null,
    model_version: null,
    nutrition_reference: null,
    deleted_at: null,
  });

  return `✅ Undone — last ${last.type} log removed.`;
}

// ── Profile questionnaire handler ─────────────────────────────────────────────────

export async function handleProfileInput(person: PersonKey, text: string): Promise<string> {
  let raw: unknown;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: PROFILE_PARSE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Profile input: [DATA: ${text.slice(0, 500)}]` }],
    });
    const txt = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const cleaned = txt.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    raw = JSON.parse(cleaned);
  } catch {
    return "Couldn't parse that. Try: *Female, 29, 162 cm, 68 kg, 62 kg, lightly active*";
  }

  if (!raw || typeof raw !== "object") return "Profile parse failed. Try again.";
  const o = raw as Record<string, unknown>;

  if (o.parse_confidence === "failed" || (o.missing_fields as string[])?.length > 2) {
    const missing = (o.missing_fields as string[] ?? []).join(", ");
    return `I'm missing: *${missing}*. Can you provide those? Example: Female, 29, 162 cm, 68 kg, 62 kg, lightly active`;
  }

  const existing = await getHealthProfile(person);
  const screenRaw = existing ? (existing as unknown as Record<string, unknown>).screen_flags : null;
  const screen = (screenRaw as Record<string, unknown>) ?? {};
  const flags = (screen.flags as string[] ?? []) as import("./types.js").SafetyFlag[];

  const targets = computeTargets(
    (o.sex as "M" | "F") ?? "F",
    Number(o.age ?? 30),
    Number(o.height_cm ?? 165),
    Number(o.weight_kg ?? 65),
    Number(o.goal_weight_kg ?? 60),
    String(o.activity ?? "lightly_active"),
    flags,
  );

  await upsertHealthProfile(person, {
    person,
    sex: o.sex as "M" | "F" ?? undefined,
    age: Number(o.age) || undefined,
    height_cm: Number(o.height_cm) || undefined,
    weight_kg: Number(o.weight_kg) || undefined,
    goal_weight_kg: Number(o.goal_weight_kg) || undefined,
    activity: o.activity as HealthProfile["activity"] ?? undefined,
    diet: typeof o.diet === "string" ? o.diet : undefined,
    allergies: Array.isArray(o.allergies) ? o.allergies as string[] : [],
    ...targets,
  } as Parameters<typeof upsertHealthProfile>[1]);

  const name = person === "krishna" ? "Krishna" : "Indhu";
  return ONBOARDING_COMPLETE(
    name,
    targets.calorie_target_low,
    targets.calorie_target_high,
    targets.protein_target_low_g,
    targets.protein_target_high_g,
    targets.goal_weeks_low,
    targets.goal_weeks_high,
  );
}

// ── Coach question answer ─────────────────────────────────────────────────────────

export async function handleCoachQuestion(
  text: string,
  person: PersonKey,
  profiles: Partial<Record<PersonKey, HealthProfile>>,
): Promise<string> {
  const prompt = buildCoachAnswerPrompt(text, person, profiles);
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text.trim() : "Sorry, couldn't answer that right now.";
  } catch {
    return "Sorry, couldn't answer that right now. Please try again.";
  }
}

// ── Export / delete (AB-085) ──────────────────────────────────────────────────────

export async function handleExport(person: PersonKey): Promise<string> {
  const data = await exportPersonData(person);
  const json = JSON.stringify(data, null, 2);
  // For WhatsApp, we can't send a file directly — send a summary and tell them
  // data will be DMed (if individual mode) or available on request
  const eventCount = Array.isArray(data.events) ? (data.events as unknown[]).length : 0;
  return [
    `📦 *Your health data export*`,
    `Events: ${eventCount}`,
    `Exported: ${data.exported_at}`,
    `_Full JSON too large for WhatsApp. Reply !export json to get it in DM (coming soon) or ask Madhan to retrieve it from the DB._`,
  ].join("\n");
}

export async function handleDeleteData(person: PersonKey): Promise<string> {
  await softDeletePersonData(person);
  return [
    `🗑️ *Your health data has been soft-deleted.*`,
    `All your logged events are now hidden. Your profile is retained.`,
    `To fully purge: contact Madhan to run the hard-delete job.`,
    `To start fresh: reply !consent yes to re-onboard.`,
  ].join("\n");
}

// ── Help text ─────────────────────────────────────────────────────────────────────

export const HEALTH_HELP = `*HealthTrack commands:*

📸 Send a food photo — auto-logged
✍️ Type food: \`2 idli sambar coffee\`
⚖️ \`!weight 74.2\` (or \`!wt\`)
😴 \`!sleep 7h\` or \`!sleep 11pm to 6am\`
🚶 \`!steps 8300\` (or \`!st\`)
🏋️ \`!workout 40 min badminton\` (or \`!ex\`)
💧 \`!water 2L\` or \`!water 500ml\`
📊 \`!report\` — today's summary
📋 \`!plan\` — ask for a meal/day plan
🔄 \`!undo\` — undo last log
✏️ \`!correct dosa 120 kcal 4g protein\`
📤 \`!export\` — download your data
🗑️ \`!delete my health data\`
🔒 \`!privacy [1-4]\` — change sharing mode

_Questions work naturally: "how many calories in palak paneer?"_`;
