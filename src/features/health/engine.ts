// Health feature — deterministic calorie/protein engine (AB-080)
// Pure functions — no LLM calls, no I/O.
// Formulas: Mifflin-St Jeor BMR, conservative TDEE, ranged deficit.

import type { HealthProfile, SafetyFlag, WeightTrend } from "./types.js";

// ── BMR / TDEE ────────────────────────────────────────────────────────────────────

const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary:          1.20,
  lightly_active:     1.30, // conservative (vs textbook 1.375)
  moderately_active:  1.45, // conservative (vs 1.55)
  very_active:        1.60, // conservative (vs 1.725)
  extra_active:       1.75, // conservative (vs 1.9)
};

export function computeBMR(sex: "M" | "F", weight_kg: number, height_cm: number, age: number): number {
  // Mifflin-St Jeor
  if (sex === "M") return Math.round(10 * weight_kg + 6.25 * height_cm - 5 * age + 5);
  return Math.round(10 * weight_kg + 6.25 * height_cm - 5 * age - 161);
}

export function computeTDEE(bmr: number, activity: string): number {
  const factor = ACTIVITY_FACTORS[activity] ?? 1.30;
  return Math.round(bmr * factor);
}

// ── Calorie targets (ranged deficit) ─────────────────────────────────────────────
// Deficit = min(500, 15-20% of maintenance). Cap at 25%. Floor 1200 kcal.
// Returns [low, high] target range.

export function computeCalorieTargets(tdee: number, safetyFlagged: boolean): [number, number] {
  if (safetyFlagged) {
    // Log-only: return maintenance range, no deficit
    return [Math.round(tdee * 0.95), tdee];
  }

  const deficit15 = Math.round(tdee * 0.15);
  const deficit20 = Math.round(tdee * 0.20);
  const cap25     = Math.round(tdee * 0.25);

  const rawLow  = Math.max(tdee - Math.min(500, deficit20), tdee - cap25);
  const rawHigh = Math.max(tdee - Math.min(500, deficit15), tdee - cap25);

  const low  = Math.max(rawLow,  1200);
  const high = Math.max(rawHigh, 1250);

  return [Math.min(low, high), Math.max(low, high)];
}

// ── Protein targets (1.2–1.6 g/kg on GOAL weight) ────────────────────────────────

export function computeProteinTargets(goal_weight_kg: number): [number, number] {
  return [Math.round(1.2 * goal_weight_kg), Math.round(1.6 * goal_weight_kg)];
}

// ── Water target ──────────────────────────────────────────────────────────────────

export function computeWaterTarget(weight_kg: number): number {
  // 35 ml/kg, min 2000 ml
  return Math.max(Math.round(35 * weight_kg), 2000);
}

// ── Goal date range ───────────────────────────────────────────────────────────────
// Shows 10–14 week range, NEVER an exact date.

export function computeGoalWeeks(
  current_kg: number,
  goal_kg: number,
  calorieTargetLow: number,
  calorieTargetHigh: number,
  tdee: number,
): { low: number; high: number } {
  const kg_to_lose = Math.max(0, current_kg - goal_kg);
  if (kg_to_lose === 0) return { low: 0, high: 0 };

  // 7700 kcal ≈ 1 kg body fat
  const dailyDeficitLow  = tdee - calorieTargetHigh;
  const dailyDeficitHigh = tdee - calorieTargetLow;
  const weeklyKgLow  = (dailyDeficitLow  * 7) / 7700;
  const weeklyKgHigh = (dailyDeficitHigh * 7) / 7700;

  const weeksHigh = weeklyKgLow  > 0 ? Math.ceil(kg_to_lose / weeklyKgLow)  : 52;
  const weeksLow  = weeklyKgHigh > 0 ? Math.ceil(kg_to_lose / weeklyKgHigh) : 26;

  return { low: Math.max(weeksLow, 4), high: Math.min(weeksHigh, 104) };
}

// ── Weight TREND recalibration ───────────────────────────────────────────────────
// Requires >= 21 days of data. Computes 7-day EWMA + median.
// Adjustment: <=100–150 kcal/step, never from a single weigh-in.

const EWMA_ALPHA = 2 / (7 + 1); // 7-day EMA

export function computeWeightTrend(
  history: Array<{ occurred_at: string; weight_kg: number }>,
): WeightTrend {
  if (history.length < 3) {
    return { ewma_kg: 0, median_kg: 0, days_of_data: history.length, trend_direction: "insufficient_data", weekly_change_kg: null };
  }

  // Sort ascending
  const sorted = [...history].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  // EWMA
  let ewma = sorted[0]!.weight_kg;
  for (const pt of sorted.slice(1)) {
    ewma = EWMA_ALPHA * pt.weight_kg + (1 - EWMA_ALPHA) * ewma;
  }

  // Median of all points
  const weights = sorted.map(p => p.weight_kg).sort((a, b) => a - b);
  const mid = Math.floor(weights.length / 2);
  const median = weights.length % 2 === 0 ? ((weights[mid - 1]! + weights[mid]!) / 2) : weights[mid]!;

  // Weekly rate of change from oldest → newest (requires >= 14 days)
  let weeklyChange: number | null = null;
  const daysDiff = (new Date(sorted[sorted.length - 1]!.occurred_at).getTime() - new Date(sorted[0]!.occurred_at).getTime()) / (86400 * 1000);
  if (daysDiff >= 14) {
    const totalChange = sorted[sorted.length - 1]!.weight_kg - sorted[0]!.weight_kg;
    weeklyChange = (totalChange / daysDiff) * 7;
  }

  const direction = weeklyChange === null ? "insufficient_data"
    : weeklyChange < -0.1 ? "losing"
    : weeklyChange > 0.1  ? "gaining"
    : "stable";

  return {
    ewma_kg: Math.round(ewma * 10) / 10,
    median_kg: Math.round(median * 10) / 10,
    days_of_data: history.length,
    trend_direction: direction,
    weekly_change_kg: weeklyChange !== null ? Math.round(weeklyChange * 100) / 100 : null,
  };
}

/**
 * Suggest a calorie target adjustment based on weight trend vs expected loss rate.
 * Requires >= 21 days of data. Returns null if insufficient data.
 * Step size: 100–150 kcal.
 */
export function suggestCalorieAdjustment(
  trend: WeightTrend,
  expectedWeeklyLossKg: number,
  currentCalorieTargetMid: number,
  safetyFlagged: boolean,
): { adjusted_target: number; direction: "reduce" | "increase" | "maintain"; reason: string } | null {
  if (safetyFlagged || trend.days_of_data < 21 || trend.weekly_change_kg === null) return null;

  const actual = trend.weekly_change_kg;
  const expected = -Math.abs(expectedWeeklyLossKg);
  const diff = actual - expected;

  if (Math.abs(diff) < 0.1) {
    return { adjusted_target: currentCalorieTargetMid, direction: "maintain", reason: "trend is on target" };
  }

  const step = 100;
  if (diff > 0.2) {
    // Losing slower than expected — reduce by 100 kcal
    const newTarget = Math.max(currentCalorieTargetMid - step, 1200);
    return { adjusted_target: newTarget, direction: "reduce", reason: `losing ${Math.abs(actual * 1000) / 1000}kg/wk vs expected ${Math.abs(expected)}kg/wk` };
  }
  if (diff < -0.2) {
    // Losing faster than expected — increase by 100-150 kcal (prevent unsustainable loss)
    const newTarget = currentCalorieTargetMid + step;
    return { adjusted_target: newTarget, direction: "increase", reason: `losing faster than planned (${Math.abs(actual)}kg/wk) — slightly increase to stay sustainable` };
  }

  return { adjusted_target: currentCalorieTargetMid, direction: "maintain", reason: "within acceptable range" };
}

// ── Safety gate ───────────────────────────────────────────────────────────────────

export function isLogOnly(flags: SafetyFlag[]): boolean {
  return flags.length > 0;
}

export function safetyFlagWarning(flags: SafetyFlag[]): string {
  if (flags.length === 0) return "";
  return [
    "⚕️ Because you indicated a health condition during onboarding, I can help you track your habits, but I won't prescribe specific calorie deficits or high-protein targets.",
    "Please work with your doctor or dietitian to set personalised nutrition goals.",
  ].join(" ");
}

// ── Full profile compute ──────────────────────────────────────────────────────────

export interface ComputedTargets {
  bmr: number;
  tdee: number;
  calorie_target_low: number;
  calorie_target_high: number;
  protein_target_low_g: number;
  protein_target_high_g: number;
  water_target_ml: number;
  goal_weeks_low: number;
  goal_weeks_high: number;
}

export function computeTargets(
  sex: "M" | "F",
  age: number,
  height_cm: number,
  weight_kg: number,
  goal_weight_kg: number,
  activity: string,
  flags: SafetyFlag[],
): ComputedTargets {
  const bmr  = computeBMR(sex, weight_kg, height_cm, age);
  const tdee = computeTDEE(bmr, activity);
  const [calLow, calHigh] = computeCalorieTargets(tdee, isLogOnly(flags));
  const [protLow, protHigh] = computeProteinTargets(goal_weight_kg);
  const water = computeWaterTarget(weight_kg);
  const { low: wksLow, high: wksHigh } = computeGoalWeeks(weight_kg, goal_weight_kg, calLow, calHigh, tdee);

  return {
    bmr, tdee,
    calorie_target_low: calLow,
    calorie_target_high: calHigh,
    protein_target_low_g: protLow,
    protein_target_high_g: protHigh,
    water_target_ml: water,
    goal_weeks_low: wksLow,
    goal_weeks_high: wksHigh,
  };
}
