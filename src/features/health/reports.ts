// Health feature — daily + weekly report builders (AB-084)
// Reports are scheduled via pi-scheduler and run on:
//   health-daily-provisional (22:00 IST) and health-daily-final (next morning 07:30 IST)
//   health-weekly (Sunday 09:00 IST)

import type { PersonKey, HealthProfile, DailyAggregate, DayStatus } from "./types.js";
import { getHealthProfile, getDailyAggregate, recomputeDailyAggregate } from "./db.js";

const STATUS_EMOJI: Record<DayStatus, string> = {
  "on-track":       "✅",
  "needs-attention": "⚑",
  "low":            "⚠️",
  "unknown":        "—",
};

function statusLine(label: string, status: DayStatus): string {
  return `${STATUS_EMOJI[status]} ${label}: ${status === "unknown" ? "no data" : status}`;
}

function istDateStr(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── Per-person daily snippet ──────────────────────────────────────────────────────

function personDailySnippet(
  name: string,
  agg: DailyAggregate,
  profile: HealthProfile,
  isFinal: boolean,
): string {
  const isPrivateVitals = profile.privacy_mode === "shared-habits-private-vitals"
    || profile.privacy_mode === "household-summary"
    || profile.privacy_mode === "individual";

  const kcalLine = agg.nutrition_status === "unknown"
    ? "🍽️ Nutrition: no food logged yet"
    : `🍽️ Est. intake: ~${agg.est_kcal_low}–${agg.est_kcal_high} kcal (target ${profile.calorie_target_low}–${profile.calorie_target_high})`;

  const proteinLine = agg.protein_status === "unknown"
    ? ""
    : `💪 Protein: ~${Math.round(agg.protein_g)}g (target ${profile.protein_target_low_g}–${profile.protein_target_high_g}g)`;

  const lines = [
    `*${name}*`,
    kcalLine,
    ...(proteinLine ? [proteinLine] : []),
    statusLine("Nutrition", agg.nutrition_status),
    statusLine("Protein",   agg.protein_status),
    statusLine("Movement",  agg.movement_status),
    statusLine("Sleep",     agg.sleep_status),
    statusLine("Hydration", agg.hydration_status),
  ];

  // Privacy: hide weight/vitals for private-vitals mode
  if (!isPrivateVitals && agg.steps > 0) {
    lines.push(`🚶 Steps: ${agg.steps.toLocaleString()}`);
  }

  if (agg.top_action) {
    lines.push(``, `💡 ${agg.top_action}`);
  }

  if (!isFinal) {
    lines.push(`_Provisional — logs until midnight count_`);
  }

  return lines.join("\n");
}

// ── Daily provisional (22:00 IST) ────────────────────────────────────────────────

export async function buildDailyProvisionalReport(): Promise<string> {
  const today = istDateStr();
  const profiles = await Promise.all([
    getHealthProfile("krishna"),
    getHealthProfile("indhu"),
  ]);

  const parts: string[] = [
    `📊 *HealthTrack — Evening Check-in*`,
    `_${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · provisional_`,
    ``,
  ];

  for (const profile of profiles) {
    if (!profile?.calorie_target_low) continue;
    const consent = profile.consent as unknown as Record<string, unknown>;
    if (!consent?.accepted) continue;

    const agg = await recomputeDailyAggregate(profile.person as PersonKey, today, profile);
    const name = profile.person === "krishna" ? "Krishna" : "Indhu";

    // Household-summary mode: show aggregate only
    if (profile.privacy_mode === "household-summary") {
      parts.push(`*${name}*: ${agg.top_action || "No data yet"}`);
    } else {
      parts.push(personDailySnippet(name, agg, profile, false));
    }
    parts.push(``);
  }

  parts.push(`_Final report tomorrow morning. Keep logging!_`);
  return parts.join("\n");
}

// ── Daily final (next morning 07:30 IST) ─────────────────────────────────────────

export async function buildDailyFinalReport(dateIST: string): Promise<string> {
  const profiles = await Promise.all([
    getHealthProfile("krishna"),
    getHealthProfile("indhu"),
  ]);

  const parts: string[] = [
    `📊 *HealthTrack — Daily Summary*`,
    `_${dateIST}_`,
    ``,
  ];

  for (const profile of profiles) {
    if (!profile?.calorie_target_low) continue;
    const consent = profile.consent as unknown as Record<string, unknown>;
    if (!consent?.accepted) continue;

    const agg = await getDailyAggregate(profile.person as PersonKey, dateIST)
      ?? await recomputeDailyAggregate(profile.person as PersonKey, dateIST, profile);
    const name = profile.person === "krishna" ? "Krishna" : "Indhu";

    if (profile.privacy_mode === "household-summary") {
      const allGood = [agg.nutrition_status, agg.protein_status, agg.movement_status].filter(s => s === "on-track").length;
      parts.push(`*${name}*: ${allGood}/3 habit goals on-track yesterday`);
    } else {
      parts.push(personDailySnippet(name, agg, profile, true));
    }
    parts.push(``);
  }

  return parts.join("\n");
}

// ── Weekly reflection (Sunday 09:00 IST) ─────────────────────────────────────────

export async function buildWeeklyReport(): Promise<string> {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const profiles = await Promise.all([
    getHealthProfile("krishna"),
    getHealthProfile("indhu"),
  ]);

  const parts: string[] = [
    `📅 *HealthTrack — Weekly Reflection*`,
    `_Last 7 days_`,
    ``,
  ];

  for (const profile of profiles) {
    if (!profile?.calorie_target_low) continue;
    const consent = profile.consent as unknown as Record<string, unknown>;
    if (!consent?.accepted) continue;

    const name = profile.person === "krishna" ? "Krishna" : "Indhu";
    const person = profile.person as PersonKey;

    // Count on-track days per metric
    const counts = { nutrition: 0, protein: 0, movement: 0, sleep: 0, hydration: 0 };
    let daysWithData = 0;

    for (const date of dates) {
      const agg = await getDailyAggregate(person, date);
      if (!agg) continue;
      daysWithData++;
      if (agg.nutrition_status === "on-track") counts.nutrition++;
      if (agg.protein_status === "on-track")   counts.protein++;
      if (agg.movement_status === "on-track")  counts.movement++;
      if (agg.sleep_status === "on-track")     counts.sleep++;
      if (agg.hydration_status === "on-track") counts.hydration++;
    }

    if (daysWithData === 0) {
      parts.push(`*${name}*: No data this week — start logging! 💪`);
      parts.push(``);
      continue;
    }

    const weekSnippet = [
      `*${name}* — ${daysWithData} of 7 days tracked`,
      `🍽️ Nutrition on-track: ${counts.nutrition}/${daysWithData} days`,
      `💪 Protein goal met: ${counts.protein}/${daysWithData} days`,
      `🚶 Movement target: ${counts.movement}/${daysWithData} days`,
      `😴 Sleep goal: ${counts.sleep}/${daysWithData} days`,
      `💧 Hydration: ${counts.hydration}/${daysWithData} days`,
    ];

    // Find the best and worst area
    const best = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]!;
    const worst = Object.entries(counts).sort(([, a], [, b]) => a - b)[0]!;

    weekSnippet.push(``, `✨ Best: ${best[0]} (${best[1]}/${daysWithData} days)`);
    if (worst[1] < daysWithData - 1) {
      weekSnippet.push(`🔍 Focus area: ${worst[0]} (${worst[1]}/${daysWithData} days)`);
    }

    parts.push(weekSnippet.join("\n"));
    parts.push(``);
  }

  parts.push([
    `_Streaks are "X of last 7" — a missed day doesn't break anything._`,
    `_Collaboration goal: both log at least 5 of 7 days this week._`,
  ].join("\n"));

  return parts.join("\n");
}
