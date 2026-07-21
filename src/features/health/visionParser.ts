// Health feature — food photo + NL + label parser (AB-081)
// Calls Claude Vision; returns validated structured JSON only.
// Untrusted user data never reaches the system prompt.

import Anthropic from "@anthropic-ai/sdk";
import type { FoodParseResult, FoodItem, ConfidenceTier, NutritionSource } from "./types.js";
import {
  FOOD_VISION_SYSTEM_PROMPT,
  FOOD_NL_SYSTEM_PROMPT,
  LABEL_VISION_SYSTEM_PROMPT,
} from "./healthPrompts.js";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001"; // cost-effective for food parsing

// ── Schema validation ─────────────────────────────────────────────────────────────

function isValidFoodItem(obj: unknown): obj is FoodItem {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.est_kcal === "number" &&
    typeof o.est_kcal_low === "number" &&
    typeof o.est_kcal_high === "number" &&
    typeof o.protein_g === "number" &&
    ["high", "medium", "low"].includes(o.confidence as string)
  );
}

function validateFoodParseResult(raw: unknown): FoodParseResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const items = Array.isArray(o.items) ? o.items.filter(isValidFoodItem) : [];
  if (!Array.isArray(o.items) || items.length === 0) return null;

  const total_est_kcal_low  = typeof o.total_est_kcal_low  === "number" ? o.total_est_kcal_low  : items.reduce((s, i) => s + i.est_kcal_low, 0);
  const total_est_kcal_high = typeof o.total_est_kcal_high === "number" ? o.total_est_kcal_high : items.reduce((s, i) => s + i.est_kcal_high, 0);
  const total_est_kcal      = typeof o.total_est_kcal      === "number" ? o.total_est_kcal      : Math.round((total_est_kcal_low + total_est_kcal_high) / 2);
  const total_protein_g     = typeof o.total_protein_g     === "number" ? o.total_protein_g     : items.reduce((s, i) => s + (i.protein_g ?? 0), 0);

  const confidence: ConfidenceTier = ["high", "medium", "low"].includes(o.confidence as string)
    ? o.confidence as ConfidenceTier
    : "low";
  const biggest_uncertainty = typeof o.biggest_uncertainty === "string" ? o.biggest_uncertainty : "portion size and preparation method";

  return {
    items,
    total_est_kcal: Math.round(total_est_kcal),
    total_est_kcal_low: Math.round(total_est_kcal_low),
    total_est_kcal_high: Math.round(total_est_kcal_high),
    total_protein_g: Math.round(total_protein_g * 10) / 10,
    confidence,
    biggest_uncertainty,
    parse_type: "vision",
  };
}

// ── Photo parser (AB-081) ─────────────────────────────────────────────────────────

export async function parseFoodPhoto(
  imageData: string,
  mimeType: string,
  caption: string,
): Promise<FoodParseResult | null> {
  // SECURITY: caption is untrusted user input — keep in user turn, never system prompt
  const userContent = caption.trim()
    ? `Analyse this food photo. User caption: [DATA: ${caption.slice(0, 200)}]`
    : "Analyse this food photo.";

  let raw: unknown;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: FOOD_VISION_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageData } },
          { type: "text", text: userContent },
        ],
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    // Strip markdown code fences if model adds them
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    raw = JSON.parse(cleaned);
  } catch (e) {
    console.error("[health:vision] parseFoodPhoto error:", e);
    return null;
  }

  const result = validateFoodParseResult(raw);
  if (result) result.parse_type = "vision";
  return result;
}

// ── NL parser (AB-081) ────────────────────────────────────────────────────────────

export async function parseFoodNL(text: string): Promise<FoodParseResult | null> {
  // SECURITY: text is untrusted — send as user-turn only, bounded to 500 chars
  const safe = text.slice(0, 500);

  let raw: unknown;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: FOOD_NL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Food description: [DATA: ${safe}]` }],
    });

    const text2 = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const cleaned = text2.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    raw = JSON.parse(cleaned);
  } catch (e) {
    console.error("[health:vision] parseFoodNL error:", e);
    return null;
  }

  const result = validateFoodParseResult(raw);
  if (result) result.parse_type = "nl";
  return result;
}

// ── Nutrition label parser (AB-081) ───────────────────────────────────────────────

export interface LabelResult {
  product_name: string;
  serving_size_g: number | null;
  servings_per_pack: number | null;
  per_100g: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  validation_flags: string[];
  confidence: ConfidenceTier;
}

export async function parseFoodLabel(imageData: string, mimeType: string): Promise<LabelResult | null> {
  let raw: unknown;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: LABEL_VISION_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageData } },
          { type: "text", text: "Read this nutrition label." },
        ],
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    raw = JSON.parse(cleaned);
  } catch (e) {
    console.error("[health:vision] parseFoodLabel error:", e);
    return null;
  }

  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    product_name: typeof o.product_name === "string" ? o.product_name : "Unknown",
    serving_size_g: typeof o.serving_size_g === "number" ? o.serving_size_g : null,
    servings_per_pack: typeof o.servings_per_pack === "number" ? o.servings_per_pack : null,
    per_100g: o.per_100g && typeof o.per_100g === "object" ? o.per_100g as LabelResult["per_100g"] : null,
    per_serving: o.per_serving && typeof o.per_serving === "object" ? o.per_serving as LabelResult["per_serving"] : null,
    validation_flags: Array.isArray(o.validation_flags) ? o.validation_flags as string[] : [],
    confidence: ["high", "medium", "low"].includes(o.confidence as string) ? o.confidence as ConfidenceTier : "low",
  };
}

/** Convert a label result to a FoodParseResult given consumed quantity. */
export function labelToFoodResult(label: LabelResult, consumed_servings: number): FoodParseResult {
  const macros = label.per_serving ?? (label.per_100g && label.serving_size_g
    ? {
        kcal: label.per_100g.kcal * label.serving_size_g / 100,
        protein_g: label.per_100g.protein_g * label.serving_size_g / 100,
        carbs_g: label.per_100g.carbs_g * label.serving_size_g / 100,
        fat_g: label.per_100g.fat_g * label.serving_size_g / 100,
      }
    : null);

  if (!macros) {
    return {
      items: [],
      total_est_kcal: 0, total_est_kcal_low: 0, total_est_kcal_high: 0,
      total_protein_g: 0, confidence: "low",
      biggest_uncertainty: "could not extract macros from label",
      parse_type: "label",
    };
  }

  const kcal = Math.round(macros.kcal * consumed_servings);
  const variance = label.confidence === "high" ? 0.05 : 0.10; // ±5% or ±10%

  return {
    items: [{
      name: label.product_name,
      portion_description: `${consumed_servings} serving${consumed_servings !== 1 ? "s" : ""}`,
      est_kcal: kcal,
      est_kcal_low: Math.round(kcal * (1 - variance)),
      est_kcal_high: Math.round(kcal * (1 + variance)),
      protein_g: Math.round(macros.protein_g * consumed_servings * 10) / 10,
      carbs_g: Math.round(macros.carbs_g * consumed_servings * 10) / 10,
      fat_g: Math.round(macros.fat_g * consumed_servings * 10) / 10,
      confidence: label.confidence,
      biggest_uncertainty: label.validation_flags.join("; ") || "none",
      source: "packaged_label" as NutritionSource,
    }],
    total_est_kcal: kcal,
    total_est_kcal_low: Math.round(kcal * (1 - variance)),
    total_est_kcal_high: Math.round(kcal * (1 + variance)),
    total_protein_g: Math.round(macros.protein_g * consumed_servings * 10) / 10,
    confidence: label.confidence,
    biggest_uncertainty: label.validation_flags.join("; ") || "none",
    parse_type: "label",
  };
}
