-- HealthTrack Phase 1 — Supabase migration (AB-079)
-- Apply once: psql or Supabase dashboard > SQL editor

-- ── Event ledger (immutable — corrections via supersedes_id + soft-delete) ──────
CREATE TABLE IF NOT EXISTS ba_health_events (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  person              TEXT NOT NULL CHECK (person IN ('krishna', 'indhu')),
  type                TEXT NOT NULL CHECK (type IN ('food','weight','sleep','steps','workout','water')),
  occurred_at         TIMESTAMPTZ NOT NULL,
  logged_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  source_message_id   TEXT UNIQUE NOT NULL,  -- WhatsApp msg id — idempotency key
  source_type         TEXT NOT NULL CHECK (source_type IN ('photo','text','label','command','import')),
  payload             JSONB NOT NULL DEFAULT '{}',
  attribution_method  TEXT NOT NULL DEFAULT 'sender',
  confidence          TEXT CHECK (confidence IN ('high','medium','low')),
  est_low             NUMERIC,
  est_high            NUMERIC,
  model_version       TEXT,
  nutrition_reference TEXT,
  supersedes_id       UUID REFERENCES ba_health_events(id),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_health_events_person_occurred ON ba_health_events (person, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_events_type ON ba_health_events (type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_events_source_msg ON ba_health_events (source_message_id);

-- ── Per-person health profile ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ba_health_profile (
  person                TEXT PRIMARY KEY CHECK (person IN ('krishna', 'indhu')),
  sex                   TEXT CHECK (sex IN ('M', 'F')),
  age                   INTEGER,
  height_cm             NUMERIC,
  weight_kg             NUMERIC,
  goal_weight_kg        NUMERIC,
  activity              TEXT CHECK (activity IN ('sedentary','lightly_active','moderately_active','very_active','extra_active')),
  diet                  TEXT,
  allergies             TEXT[] DEFAULT '{}',
  bmr                   NUMERIC,
  tdee                  NUMERIC,
  calorie_target_low    NUMERIC,
  calorie_target_high   NUMERIC,
  protein_target_low_g  NUMERIC,
  protein_target_high_g NUMERIC,
  water_target_ml       NUMERIC,
  goal_weeks_low        INTEGER,
  goal_weeks_high       INTEGER,
  consent               JSONB NOT NULL DEFAULT '{}',
  screen_flags          JSONB NOT NULL DEFAULT '{}',
  privacy_mode          TEXT NOT NULL DEFAULT 'shared-habits-private-vitals',
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Food cache (AI estimates + user corrections) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS ba_health_food_cache (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dish                  TEXT NOT NULL,
  prep_style            TEXT,
  home_or_restaurant    TEXT CHECK (home_or_restaurant IN ('home','restaurant','packaged','unknown')),
  household             TEXT DEFAULT 'default',
  portion_unit          TEXT NOT NULL DEFAULT 'serving',
  portion_qty           NUMERIC NOT NULL DEFAULT 1,
  est_kcal_per_portion  NUMERIC NOT NULL,
  est_kcal_low          NUMERIC NOT NULL,
  est_kcal_high         NUMERIC NOT NULL,
  protein_g             NUMERIC NOT NULL DEFAULT 0,
  carbs_g               NUMERIC NOT NULL DEFAULT 0,
  fat_g                 NUMERIC NOT NULL DEFAULT 0,
  nutrition_source      TEXT NOT NULL DEFAULT 'ai_estimate',
  user_correction_count INTEGER NOT NULL DEFAULT 0,
  model_version         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_food_cache_dish ON ba_health_food_cache (lower(dish), home_or_restaurant);

-- ── Saved meals / recipes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ba_health_saved_foods (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  person      TEXT CHECK (person IN ('krishna','indhu','both')),
  name        TEXT NOT NULL,
  recipe_json JSONB NOT NULL DEFAULT '{}',
  macros      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Recomputable daily aggregate ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ba_health_daily (
  person              TEXT NOT NULL CHECK (person IN ('krishna', 'indhu')),
  date                DATE NOT NULL,
  est_kcal_low        NUMERIC NOT NULL DEFAULT 0,
  est_kcal_high       NUMERIC NOT NULL DEFAULT 0,
  protein_g           NUMERIC NOT NULL DEFAULT 0,
  steps               INTEGER NOT NULL DEFAULT 0,
  sleep_hours         NUMERIC NOT NULL DEFAULT 0,
  water_ml            NUMERIC NOT NULL DEFAULT 0,
  nutrition_status    TEXT NOT NULL DEFAULT 'unknown',
  protein_status      TEXT NOT NULL DEFAULT 'unknown',
  movement_status     TEXT NOT NULL DEFAULT 'unknown',
  sleep_status        TEXT NOT NULL DEFAULT 'unknown',
  hydration_status    TEXT NOT NULL DEFAULT 'unknown',
  top_action          TEXT NOT NULL DEFAULT '',
  recomputed_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (person, date)
);

-- ── Mutation audit log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ba_health_audit (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  person        TEXT NOT NULL,
  action        TEXT NOT NULL,
  event_id      UUID REFERENCES ba_health_events(id),
  performed_at  TIMESTAMPTZ DEFAULT NOW(),
  details       JSONB DEFAULT '{}'
);

-- ── RLS policies ─────────────────────────────────────────────────────────────────
-- Enable RLS on all tables (bot uses service role key locally, so RLS is advisory here
-- but guards future direct access paths)
ALTER TABLE ba_health_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ba_health_profile   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ba_health_food_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ba_health_saved_foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE ba_health_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ba_health_audit     ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; no explicit policy needed for the bot.
-- If a restricted read role is added later, add SELECT-only policies here.
