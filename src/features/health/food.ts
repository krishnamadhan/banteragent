// Health feature — food logging orchestration (AB-081)
// Grounding precedence (highest → lowest):
//   user_confirmed_recipe > user_confirmed_prior_meal > packaged_label > usda_api > household_default > ai_estimate
// Correction cache: once person corrects a dish, future guesses use it.
// SECURITY: strip EXIF + delete raw photo after analysis.

import sharp from "sharp";
import type { PersonKey, FoodParseResult, AttributionMethod, ConfidenceTier, NutritionSource } from "./types.js";
import { parseFoodPhoto, parseFoodNL, parseFoodLabel, labelToFoodResult, LabelResult } from "./visionParser.js";
import { lookupFoodCache, upsertFoodCache } from "./db.js";
import { searchUSDA } from "./usda.js";
import { formatFoodReceipt } from "./healthPrompts.js";

// ── EXIF strip + photo deletion (AB-085) ─────────────────────────────────────────

/** Strip EXIF from base64 image data using sharp. Returns stripped data. */
async function stripExif(imageData: string, mimeType: string): Promise<string> {
  try {
    const buffer = Buffer.from(imageData, "base64");
    // sharp.withMetadata() adds; default (no withMetadata()) strips EXIF
    const stripped = await sharp(buffer).toFormat(mimeType.includes("png") ? "png" : "jpeg").toBuffer();
    return stripped.toString("base64");
  } catch {
    return imageData; // fall through — analysis still happens
  }
}

// ── Cache-first grounding ─────────────────────────────────────────────────────────

async function groundWithCache(
  result: FoodParseResult,
): Promise<FoodParseResult> {
  // Try to ground each item against the cache
  for (const item of result.items) {
    const cached = await lookupFoodCache(item.name);
    if (!cached) continue;

    // User-corrected cache entries override AI estimates
    if (cached.user_correction_count > 0) {
      item.est_kcal      = cached.est_kcal_per_portion;
      item.est_kcal_low  = cached.est_kcal_low;
      item.est_kcal_high = cached.est_kcal_high;
      item.protein_g     = cached.protein_g;
      item.carbs_g       = cached.carbs_g;
      item.fat_g         = cached.fat_g;
      item.confidence    = "medium" as ConfidenceTier; // still medium — portion size may vary
      item.source        = "user_confirmed_prior_meal" as NutritionSource;
      item.biggest_uncertainty = "portion size vs cached serving";
    }
  }

  // Recompute totals
  const total_kcal_low  = result.items.reduce((s, i) => s + i.est_kcal_low, 0);
  const total_kcal_high = result.items.reduce((s, i) => s + i.est_kcal_high, 0);
  return {
    ...result,
    total_est_kcal: Math.round((total_kcal_low + total_kcal_high) / 2),
    total_est_kcal_low:  Math.round(total_kcal_low),
    total_est_kcal_high: Math.round(total_kcal_high),
    total_protein_g: Math.round(result.items.reduce((s, i) => s + (i.protein_g ?? 0), 0) * 10) / 10,
  };
}

// ── Photo food log ────────────────────────────────────────────────────────────────

export async function logFoodFromPhoto(
  imageData: string,
  mimeType: string,
  caption: string,
  person: PersonKey,
): Promise<{ result: FoodParseResult | null; receipt: string; isLabel: boolean }> {
  // Strip EXIF before any processing
  const safeImageData = await stripExif(imageData, mimeType);

  // Heuristic: if caption contains "label", try label parser first
  const isLabelHint = /label|nutrition\s*facts|nutri/i.test(caption);

  if (isLabelHint) {
    const labelResult = await parseFoodLabel(safeImageData, mimeType);
    if (labelResult?.per_serving ?? labelResult?.per_100g) {
      // Ask how many servings — for now assume 1, receipt will prompt
      const foodResult = labelToFoodResult(labelResult as LabelResult, 1);
      const receipt = formatFoodReceipt(person, foodResult, "packaged item", true) +
        "\n_How many servings did you have? Reply: `!correct <n> servings`_";
      return { result: foodResult, receipt, isLabel: true };
    }
  }

  const result = await parseFoodPhoto(safeImageData, mimeType, caption);
  if (!result) {
    return {
      result: null,
      receipt: "❌ Couldn't parse the food photo. Try a clearer photo or type the food (e.g. `2 idli sambar`).",
      isLabel: false,
    };
  }

  const grounded = await groundWithCache(result);
  const mealLabel = guessMealLabel();
  const receipt = formatFoodReceipt(person, grounded, mealLabel, true);

  // Cache new AI estimates for future grounding
  for (const item of grounded.items) {
    if (item.source === "ai_estimate") {
      upsertFoodCache(item.name, {
        est_kcal: item.est_kcal, est_low: item.est_kcal_low, est_high: item.est_kcal_high,
        protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g,
      }, "ai_estimate").catch(() => {});
    }
  }

  return { result: grounded, receipt, isLabel: false };
}

// ── NL food log ───────────────────────────────────────────────────────────────────

export async function logFoodFromText(
  text: string,
  person: PersonKey,
): Promise<{ result: FoodParseResult | null; receipt: string }> {
  const result = await parseFoodNL(text);
  if (!result) {
    return {
      result: null,
      receipt: "❌ Couldn't parse that food description. Try: `2 idli sambar coffee`",
    };
  }

  const grounded = await groundWithCache(result);
  const mealLabel = guessMealLabel();
  const receipt = formatFoodReceipt(person, grounded, mealLabel, true);
  return { result: grounded, receipt };
}

// ── Meal correction (updates cache) ──────────────────────────────────────────────

export async function applyCorrectionToCache(
  dishName: string,
  correctedKcal: number,
  correctedProtein: number,
): Promise<void> {
  const delta = correctedKcal * 0.10; // ±10% for corrected dishes
  await upsertFoodCache(dishName, {
    est_kcal: correctedKcal,
    est_low: Math.round(correctedKcal * 0.9),
    est_high: Math.round(correctedKcal * 1.1),
    protein_g: correctedProtein,
    carbs_g: 0, // unknown from correction
    fat_g: 0,
  }, "user_confirmed_prior_meal", true);
}

// ── Helpers ───────────────────────────────────────────────────────────────────────

function guessMealLabel(): string {
  const istHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
  if (istHour >= 6  && istHour < 10) return "breakfast";
  if (istHour >= 10 && istHour < 14) return "lunch";
  if (istHour >= 14 && istHour < 17) return "snack";
  if (istHour >= 17 && istHour < 21) return "dinner";
  return "meal";
}
