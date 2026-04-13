-- ============================================================
-- Migration 006 — Fitness challenge (pushup tracking)
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS ba_fitness_scores (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id      TEXT        NOT NULL,
  sender_phone  TEXT        NOT NULL,
  sender_name   TEXT        NOT NULL,
  exercise_type TEXT        NOT NULL DEFAULT 'pushup',
  claimed_reps  INT         NOT NULL,
  valid_reps    INT         NOT NULL DEFAULT 0,
  form_score    INT         NOT NULL DEFAULT 5 CHECK (form_score BETWEEN 1 AND 10),
  verdict       TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ba_fitness_group_week
  ON ba_fitness_scores (group_id, submitted_at);

CREATE INDEX IF NOT EXISTS idx_ba_fitness_sender
  ON ba_fitness_scores (sender_phone, group_id);
