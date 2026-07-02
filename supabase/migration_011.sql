-- migration_011: expense tracker v2
-- Run in Supabase SQL Editor

-- New columns on ba_expenses (safe to run multiple times)
ALTER TABLE ba_expenses
  ADD COLUMN IF NOT EXISTS log_id       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS subcategory  TEXT,
  ADD COLUMN IF NOT EXISTS source       TEXT DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS confidence   NUMERIC,
  ADD COLUMN IF NOT EXISTS notes        TEXT,
  ADD COLUMN IF NOT EXISTS is_split     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_details JSONB,
  ADD COLUMN IF NOT EXISTS is_weekend   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Split events table
CREATE TABLE IF NOT EXISTS ba_splits (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id     TEXT,
  expense_ids  TEXT[],
  split_type   TEXT,
  total_amount NUMERIC,
  per_person   NUMERIC,
  member_count INT,
  payer        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  created_by   TEXT,
  details      JSONB
);
