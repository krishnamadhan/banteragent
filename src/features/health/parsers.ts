// Health feature — deterministic NL metric parsers (AB-083)
// Pure functions; no LLM. Validates numeric plausibility in app code.

import type { ParsedMetric, EventType } from "./types.js";

// ── Plausibility bounds (AB-083) ──────────────────────────────────────────────────

const PLAUSIBILITY: Record<string, { min: number; max: number; unit: string; confirmThreshold?: number }> = {
  weight:  { min: 30,   max: 250,   unit: "kg",   confirmThreshold: 150 },
  sleep:   { min: 0.5,  max: 24,    unit: "hours" },
  steps:   { min: 0,    max: 70000, unit: "steps", confirmThreshold: 50000 },
  workout: { min: 1,    max: 600,   unit: "minutes" },
  water:   { min: 0,    max: 10000, unit: "ml" },
};

export function isPlausible(type: string, value: number): boolean {
  const bounds = PLAUSIBILITY[type];
  if (!bounds) return true;
  return value >= bounds.min && value <= bounds.max;
}

export function needsConfirmation(type: string, value: number): boolean {
  const bounds = PLAUSIBILITY[type];
  if (!bounds?.confirmThreshold) return false;
  return value > bounds.confirmThreshold;
}

export function plausibilityWarning(type: string, value: number): string {
  const bounds = PLAUSIBILITY[type];
  if (!bounds) return "";
  return `That ${type} value (${value} ${bounds.unit}) seems unusual. Did you mean ${value}?`;
}

// ── Weight parser ─────────────────────────────────────────────────────────────────

export function parseWeight(text: string): ParsedMetric | null {
  // "74.2", "74.2 kg", "weight 74.2", "!weight 74.2", "!wt 74.2"
  const m = text.match(/(?:!wt|!weight|weight(?:\s+is)?|weighed|weigh)\s*([\d.]+)\s*(?:kg?|kgs?|kilos?)?/i)
    ?? text.match(/^([\d.]+)\s*(?:kg?|kgs?|kilos?)?\s*$/i);
  if (!m) return null;

  const value = parseFloat(m[1]!);
  if (isNaN(value) || !isPlausible("weight", value)) return null;

  return { type: "weight", value, unit: "kg" };
}

// ── Sleep parser ──────────────────────────────────────────────────────────────────

export function parseSleep(text: string): ParsedMetric | null {
  // "slept 7h", "slept 7 hours", "sleep 11 to 6", "slept 11pm to 6am", "7.5 hrs sleep"
  const directHours = text.match(/(?:!sleep|slept?|sleep)\s*([\d.]+)\s*h(?:r|ours?)?/i);
  if (directHours) {
    const hours = parseFloat(directHours[1]!);
    if (!isNaN(hours) && isPlausible("sleep", hours)) return { type: "sleep", value: hours, unit: "hours" };
  }

  // "slept 11 to 6" or "11pm to 6am"
  const range = text.match(/(?:slept?|sleep)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (range) {
    let bedH = parseInt(range[1]!, 10);
    const bedMeridiem  = (range[3] ?? "").toLowerCase();
    let wakeH = parseInt(range[4]!, 10);
    const wakeMeridiem = (range[6] ?? "").toLowerCase();

    if (bedMeridiem === "pm" && bedH < 12)  bedH  += 12;
    if (wakeMeridiem === "am" && wakeH === 12) wakeH = 0;
    if (bedH >= wakeH) wakeH += 24;

    const hours = wakeH - bedH + (parseInt(range[5] ?? "0") - parseInt(range[2] ?? "0")) / 60;
    if (isPlausible("sleep", hours)) {
      return {
        type: "sleep", value: Math.round(hours * 10) / 10, unit: "hours",
        extra: { bed_hour: bedH % 24, wake_hour: wakeH % 24 },
      };
    }
  }

  return null;
}

// ── Steps parser ──────────────────────────────────────────────────────────────────

export function parseSteps(text: string): ParsedMetric | null {
  // "8300 steps", "!steps 8300", "!st 8300", "walked 8.3k steps"
  const m = text.match(/(?:!st(?:eps)?|steps?|walked?)\s*([\d.,]+)\s*k?\s*(?:steps?)?/i)
    ?? text.match(/([\d,]+)\s+steps?/i);
  if (!m) return null;

  let raw = m[1]!.replace(/,/g, "");
  const isK = m[0]!.includes("k") && !raw.includes("000");
  const value = isK ? parseFloat(raw) * 1000 : parseFloat(raw);

  if (isNaN(value) || !isPlausible("steps", value)) return null;
  return { type: "steps", value: Math.round(value), unit: "steps" };
}

// ── Workout parser ────────────────────────────────────────────────────────────────

export function parseWorkout(text: string): ParsedMetric | null {
  // "40 min badminton", "!workout 40 min badminton", "!ex 30 yoga", "ran for 20 minutes"
  const m = text.match(/(?:!ex(?:ercise)?|!workout|workout|exercise|gym|ran?|swam?|cycled?|played?|yoga|badminton|tennis|walked?)\s+([\d.]+)\s*(?:min(?:utes?)?|hrs?|hours?)?/i)
    ?? text.match(/([\d.]+)\s+min(?:utes?)?\s+(?:of\s+)?(?:badminton|yoga|gym|run|walk|swim|cycle|exercise|tennis)/i);
  if (!m) return null;

  const raw = parseFloat(m[1]!);
  const isHours = m[0]!.match(/hr|hour/i);
  const value = isHours ? raw * 60 : raw;

  if (isNaN(value) || !isPlausible("workout", value)) return null;

  const activityMatch = text.match(/(?:badminton|yoga|gym|run(?:ning)?|walk(?:ing)?|swim(?:ming)?|cycling?|tennis|exercise)/i);
  const activity = activityMatch ? activityMatch[0].toLowerCase() : "exercise";

  return { type: "workout", value: Math.round(value), unit: "minutes", extra: { activity } };
}

// ── Water parser ──────────────────────────────────────────────────────────────────

export function parseWater(text: string): ParsedMetric | null {
  // "2L water", "2000ml water", "!water 500ml", "drank 2 glasses water"
  const mlMatch = text.match(/(?:!water|water|drank?)\s*([\d.]+)\s*(?:ml|liters?|litres?|l\b)/i);
  if (mlMatch) {
    const raw = parseFloat(mlMatch[1]!);
    const isLiters = /l\b|liter|litre/i.test(mlMatch[0]!);
    const ml = isLiters ? raw * 1000 : raw;
    if (!isNaN(ml) && isPlausible("water", ml)) return { type: "water", value: Math.round(ml), unit: "ml" };
  }

  // "3 glasses water" — 1 glass ≈ 250ml
  const glassMatch = text.match(/(\d+)\s+glasses?\s+(?:of\s+)?water/i);
  if (glassMatch) {
    const ml = parseInt(glassMatch[1]!) * 250;
    if (isPlausible("water", ml)) return { type: "water", value: ml, unit: "ml" };
  }

  return null;
}

// ── Undo / edit detector ──────────────────────────────────────────────────────────

export function parseUndoRequest(text: string): boolean {
  return /^!undo\b|^undo\s+last\b/i.test(text.trim());
}

export function parseEditRequest(text: string): { dishName?: string; correctedKcal?: number; correctedProtein?: number } | null {
  // "!correct dosa 120 kcal 4g protein" or "edit dosa 120"
  const m = text.match(/(?:!correct|correct|edit|fix)\s+(.+?)\s+(\d+)\s*(?:kcal|cal)?(?:\s+([\d.]+)\s*g?\s*protein)?/i);
  if (!m) return null;
  return {
    dishName: m[1]!.trim(),
    correctedKcal: parseInt(m[2]!),
    correctedProtein: m[3] ? parseFloat(m[3]!) : undefined,
  };
}

// ── Master metric parser ──────────────────────────────────────────────────────────

export function parseMetric(text: string): ParsedMetric | null {
  return (
    parseWeight(text) ??
    parseSleep(text)  ??
    parseSteps(text)  ??
    parseWorkout(text) ??
    parseWater(text)
  );
}
