// Health feature — couple attribution + meal timing state machine (AB-082)
// Validate attribution in APP code, not the model.
// Two-plate: pending meal store; expire if unanswered.

import { randomUUID } from "crypto";
import type { PersonKey, FoodParseResult, AttributionMethod, PendingMeal } from "./types.js";

// ── Pending meal store (in-memory; resets on restart — meals expire quickly) ──────

const pendingMeals = new Map<string, PendingMeal>();
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes to answer attribution question

export function storePendingMeal(
  quotedMessageId: string,
  initiatorPerson: PersonKey,
  foodResult: FoodParseResult,
  rawMessageId: string,
): PendingMeal {
  const now = Date.now();
  const meal: PendingMeal = {
    id: randomUUID(),
    quoted_message_id: quotedMessageId,
    initiator_person: initiatorPerson,
    food_result: foodResult,
    raw_message_id: rawMessageId,
    created_at: now,
    expires_at: now + PENDING_TTL_MS,
  };
  pendingMeals.set(quotedMessageId, meal);
  return meal;
}

export function getPendingMeal(quotedMessageId: string): PendingMeal | null {
  const meal = pendingMeals.get(quotedMessageId);
  if (!meal) return null;
  if (Date.now() > meal.expires_at) {
    pendingMeals.delete(quotedMessageId);
    return null;
  }
  return meal;
}

export function clearPendingMeal(quotedMessageId: string): void {
  pendingMeals.delete(quotedMessageId);
}

// Prune expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, meal] of pendingMeals) {
    if (now > meal.expires_at) pendingMeals.delete(key);
  }
}, 5 * 60 * 1000);

// ── Attribution resolution ────────────────────────────────────────────────────────

export type AttributedMeal = {
  person: PersonKey;
  food_result: FoodParseResult;
  attribution_method: AttributionMethod;
};

/**
 * Resolve attribution from message context.
 * Returns one or two AttributedMeal entries (two for "both" / "split").
 */
export function resolveAttribution(
  senderPerson: PersonKey,
  text: string,
  quotedMsgId: string | undefined,
  foodResult: FoodParseResult,
): { meals: AttributedMeal[]; askQuestion: string | null } {
  const t = text.toLowerCase();

  // Explicit "for both" → duplicate entry per person
  if (/\bfor\s+both\b/.test(t)) {
    return {
      meals: [
        { person: "krishna", food_result: scaleFoodResult(foodResult, 1), attribution_method: "explicit_both" },
        { person: "indhu",   food_result: scaleFoodResult(foodResult, 1), attribution_method: "explicit_both" },
      ],
      askQuestion: null,
    };
  }

  // Explicit "for Krishna" or "for Indhu"
  const forKrishna = /\bfor\s+krishna\b|\bfor\s+him\b/.test(t);
  const forIndhu   = /\bfor\s+indhu\b|\bfor\s+her\b/.test(t);

  if (forKrishna && !forIndhu) {
    return {
      meals: [{ person: "krishna", food_result: foodResult, attribution_method: "explicit_other" }],
      askQuestion: null,
    };
  }
  if (forIndhu && !forKrishna) {
    return {
      meals: [{ person: "indhu", food_result: foodResult, attribution_method: "explicit_other" }],
      askQuestion: null,
    };
  }

  // Split by percentage: "split 60/40" or "split 60 40" or "for both split 60/40"
  const splitMatch = t.match(/split\s+(\d+)[/\s](\d+)/);
  if (splitMatch) {
    const pctKrishna = parseInt(splitMatch[1]!, 10) / 100;
    const pctIndhu   = parseInt(splitMatch[2]!, 10) / 100;
    return {
      meals: [
        { person: "krishna", food_result: scaleFoodResult(foodResult, pctKrishna), attribution_method: "split_pct" },
        { person: "indhu",   food_result: scaleFoodResult(foodResult, pctIndhu),   attribution_method: "split_pct" },
      ],
      askQuestion: null,
    };
  }

  // "same for Indhu 0.8" — scale by factor
  const scaleMatch = t.match(/(?:same for\s+(\w+)|for\s+(\w+))\s+([\d.]+)/);
  if (scaleMatch && quotedMsgId) {
    const scale = parseFloat(scaleMatch[3]!);
    const targetName = (scaleMatch[1] ?? scaleMatch[2] ?? "").toLowerCase();
    const targetPerson: PersonKey = targetName.includes("indhu") ? "indhu" : "krishna";
    if (scale > 0 && scale <= 3) {
      return {
        meals: [{ person: targetPerson, food_result: scaleFoodResult(foodResult, scale), attribution_method: "quoted_msg" }],
        askQuestion: null,
      };
    }
  }

  // Two-plate detection: image with no caption and no quoted → ask
  if (!text.trim() || text.trim().length < 5) {
    return {
      meals: [],
      askQuestion: "Who ate this? Reply: `for me` · `for Indhu/Krishna` · `for both` · `split 60/40`",
    };
  }

  // Default: sender
  return {
    meals: [{ person: senderPerson, food_result: foodResult, attribution_method: "sender" }],
    askQuestion: null,
  };
}

function scaleFoodResult(result: FoodParseResult, factor: number): FoodParseResult {
  return {
    ...result,
    items: result.items.map(item => ({
      ...item,
      est_kcal:      Math.round(item.est_kcal * factor),
      est_kcal_low:  Math.round(item.est_kcal_low * factor),
      est_kcal_high: Math.round(item.est_kcal_high * factor),
      protein_g:     Math.round(item.protein_g * factor * 10) / 10,
      carbs_g:       Math.round(item.carbs_g * factor * 10) / 10,
      fat_g:         Math.round(item.fat_g * factor * 10) / 10,
    })),
    total_est_kcal:      Math.round(result.total_est_kcal * factor),
    total_est_kcal_low:  Math.round(result.total_est_kcal_low * factor),
    total_est_kcal_high: Math.round(result.total_est_kcal_high * factor),
    total_protein_g:     Math.round(result.total_protein_g * factor * 10) / 10,
  };
}

// ── Timing overrides (AB-082) ─────────────────────────────────────────────────────

/**
 * Parse NL time expressions to an ISO timestamp (IST).
 * Returns null if no time override detected.
 * Validation happens here in app code, not the model.
 */
export function parseTimeOverride(text: string, baseTs: number = Date.now()): string | null {
  const t = text.toLowerCase();

  // "2 hrs ago" / "2 hours ago"
  const hoursAgo = t.match(/(\d+(?:\.\d+)?)\s*h(?:r|ours?)?\s*ago/);
  if (hoursAgo) {
    const hrs = parseFloat(hoursAgo[1]!);
    if (hrs >= 0 && hrs <= 24) {
      return new Date(baseTs - hrs * 3600 * 1000).toISOString();
    }
  }

  // "at 1pm" / "at 13:30"
  const atTime = t.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atTime) {
    let hour = parseInt(atTime[1]!, 10);
    const min = parseInt(atTime[2] ?? "0", 10);
    const meridiem = atTime[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const baseDate = new Date(baseTs);
    const ist = new Date(baseTs + 5.5 * 60 * 60 * 1000);
    const year = ist.getUTCFullYear(), month = ist.getUTCMonth(), day = ist.getUTCDate();
    const targetUTC = new Date(Date.UTC(year, month, day, hour - 5, min - 30));
    const targetTs = targetUTC.getTime();

    // Sanity check: must be in past and within 24 hours
    if (targetTs < baseTs && baseTs - targetTs <= 24 * 3600 * 1000) {
      return targetUTC.toISOString();
    }
  }

  // "that was 1pm" / "was at 6"
  const wasAt = t.match(/(?:that was|was at|logged at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (wasAt) {
    return parseTimeOverride(`at ${wasAt[1]}${wasAt[2] ? ":" + wasAt[2] : ""} ${wasAt[3] ?? ""}`, baseTs);
  }

  return null;
}
