// Health feature — shared TypeScript interfaces (AB-079)

export type PersonKey = "krishna" | "indhu";

export type PrivacyMode =
  | "shared-all"
  | "shared-habits-private-vitals"
  | "household-summary"
  | "individual";

export type SafetyFlag =
  | "under18"
  | "pregnancy_ttc_breastfeeding"
  | "eating_disorder"
  | "insulin_hypoglycemia_meds"
  | "kidney_liver_cardiac_metabolic";

export type ConsentStatus = "pending" | "accepted" | "declined";

export type ConfidenceTier = "high" | "medium" | "low";

export type AttributionMethod =
  | "sender"
  | "explicit_self"
  | "explicit_other"
  | "explicit_both"
  | "split_pct"
  | "shared_dish"
  | "quoted_msg";

export type EventType = "food" | "weight" | "sleep" | "steps" | "workout" | "water";

export type SourceType = "photo" | "text" | "label" | "command" | "import";

export type NutritionSource =
  | "user_confirmed_recipe"
  | "user_confirmed_prior_meal"
  | "packaged_label"
  | "usda_api"
  | "household_default"
  | "ai_estimate";

export type IntentLabel =
  | "log"
  | "question"
  | "plan"
  | "correction"
  | "attribution"
  | "report"
  | "non_health";

export type DayStatus = "on-track" | "needs-attention" | "low" | "unknown";

export interface PersonConsent {
  accepted: boolean;
  accepted_at: string | null;
  data_collected_ack: boolean;
  partner_visibility_ack: boolean;
  photo_retention_ack: boolean;
  claude_processing_ack: boolean;
  storage_ack: boolean;
  reminders_ack: boolean;
  privacy_mode: PrivacyMode;
}

export interface SafetyScreen {
  screened: boolean;
  screened_at: string | null;
  flags: SafetyFlag[];
  log_only: boolean;
}

export interface HealthProfile {
  person: PersonKey;
  sex: "M" | "F";
  age: number;
  height_cm: number;
  weight_kg: number;
  goal_weight_kg: number;
  activity: "sedentary" | "lightly_active" | "moderately_active" | "very_active" | "extra_active";
  diet: string;
  allergies: string[];
  bmr: number;
  tdee: number;
  calorie_target_low: number;
  calorie_target_high: number;
  protein_target_low_g: number;
  protein_target_high_g: number;
  water_target_ml: number;
  goal_weeks_low: number;
  goal_weeks_high: number;
  consent: PersonConsent;
  screen: SafetyScreen;
  privacy_mode: PrivacyMode;
}

export interface FoodItem {
  name: string;
  portion_description: string;
  est_kcal: number;
  est_kcal_low: number;
  est_kcal_high: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: ConfidenceTier;
  biggest_uncertainty: string;
  source: NutritionSource;
}

export interface FoodParseResult {
  items: FoodItem[];
  total_est_kcal: number;
  total_est_kcal_low: number;
  total_est_kcal_high: number;
  total_protein_g: number;
  confidence: ConfidenceTier;
  biggest_uncertainty: string;
  parse_type: "vision" | "nl" | "label";
  raw_text?: string;
}

export interface HealthEvent {
  id?: string;
  person: PersonKey;
  type: EventType;
  occurred_at: string;
  logged_at: string;
  timezone: "Asia/Kolkata";
  source_message_id: string;
  source_type: SourceType;
  payload: Record<string, unknown>;
  attribution_method: AttributionMethod;
  confidence: ConfidenceTier | null;
  est_low: number | null;
  est_high: number | null;
  model_version: string | null;
  nutrition_reference: string | null;
  supersedes_id: string | null;
  deleted_at: string | null;
}

export interface DailyAggregate {
  person: PersonKey;
  date: string;
  est_kcal_low: number;
  est_kcal_high: number;
  protein_g: number;
  steps: number;
  sleep_hours: number;
  water_ml: number;
  nutrition_status: DayStatus;
  protein_status: DayStatus;
  movement_status: DayStatus;
  sleep_status: DayStatus;
  hydration_status: DayStatus;
  top_action: string;
}

export interface PendingMeal {
  id: string;
  quoted_message_id: string;
  initiator_person: PersonKey;
  food_result: FoodParseResult;
  raw_message_id: string;
  created_at: number;
  expires_at: number;
}

export interface IntentClassification {
  intent: IntentLabel;
  confidence: "high" | "low";
  target_person?: PersonKey | "both";
}

export interface ParsedMetric {
  type: EventType;
  value: number;
  unit?: string;
  occurred_at?: string;
  extra?: Record<string, unknown>;
}

export interface WeightTrend {
  ewma_kg: number;
  median_kg: number;
  days_of_data: number;
  trend_direction: "losing" | "gaining" | "stable" | "insufficient_data";
  weekly_change_kg: number | null;
}
