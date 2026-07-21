// Health feature — USDA FoodData Central API client (AB-081)
// CC0-licensed nutritional data. Requires USDA_API_KEY in env.
// Do NOT ingest ICMR-NIN IFCT PDF — copyright restricted.

export interface UsdaFood {
  fdcId: number;
  description: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  data_type: string;
}

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

function getApiKey(): string | null {
  return process.env.USDA_API_KEY ?? null;
}

function getNutrientValue(nutrients: Array<{ nutrientId: number; value: number }>, id: number): number {
  return nutrients.find(n => n.nutrientId === id)?.value ?? 0;
}

export async function searchUSDA(query: string, maxResults = 3): Promise<UsdaFood[]> {
  const key = getApiKey();
  if (!key) {
    console.warn("[health:usda] USDA_API_KEY not set — skipping USDA lookup");
    return [];
  }

  try {
    const url = `${USDA_BASE}/foods/search?api_key=${key}&query=${encodeURIComponent(query)}&pageSize=${maxResults}&dataType=SR Legacy,Foundation,Branded`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error("[health:usda] search failed:", res.status);
      return [];
    }

    const json = await res.json() as { foods?: Array<{ fdcId: number; description: string; dataType: string; foodNutrients: Array<{ nutrientId: number; value: number }> }> };
    if (!json.foods?.length) return [];

    return json.foods.map(f => ({
      fdcId: f.fdcId,
      description: f.description,
      kcal_per_100g: getNutrientValue(f.foodNutrients, 1008), // Energy (kcal)
      protein_g_per_100g: getNutrientValue(f.foodNutrients, 1003), // Protein
      carbs_g_per_100g: getNutrientValue(f.foodNutrients, 1005), // Carbohydrates
      fat_g_per_100g: getNutrientValue(f.foodNutrients, 1004), // Total fat
      data_type: f.dataType,
    }));
  } catch (e) {
    console.error("[health:usda] request error:", e);
    return [];
  }
}

/** Get per-portion macros for a USDA food given consumed grams. */
export function usdaMacrosForGrams(food: UsdaFood, grams: number): { kcal: number; protein_g: number; carbs_g: number; fat_g: number } {
  const ratio = grams / 100;
  return {
    kcal:       Math.round(food.kcal_per_100g * ratio),
    protein_g:  Math.round(food.protein_g_per_100g * ratio * 10) / 10,
    carbs_g:    Math.round(food.carbs_g_per_100g * ratio * 10) / 10,
    fat_g:      Math.round(food.fat_g_per_100g * ratio * 10) / 10,
  };
}
