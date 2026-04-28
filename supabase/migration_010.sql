-- Migration 010: Document Solli Adi tables
-- ba_solli_adi and ba_solli_adi_prediction existed in the DB but had no schema
-- file — this creates them idempotently for any fresh environment.

-- ─── Round table ──────────────────────────────────────────────────────────────
-- One round per group per over during a live match.
CREATE TABLE IF NOT EXISTS ba_solli_adi (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id            TEXT        NOT NULL,
  group_id            TEXT        NOT NULL,
  over_number         INT         NOT NULL,  -- 0-based; display = over_number + 1
  balls_at_open       INT         NOT NULL DEFAULT 0,
  score_at_start      INT         NOT NULL DEFAULT 0,
  score_at_over_start INT,                   -- set when pending→open transition
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','open','resolved','void')),
  actual_runs         INT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ba_solli_adi_group_match
  ON ba_solli_adi (group_id, match_id);

CREATE INDEX IF NOT EXISTS idx_ba_solli_adi_open
  ON ba_solli_adi (group_id, status)
  WHERE status IN ('pending', 'open');

-- ─── Predictions table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ba_solli_adi_prediction (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id        BIGINT      NOT NULL REFERENCES ba_solli_adi(id) ON DELETE CASCADE,
  user_phone      TEXT        NOT NULL,
  user_name       TEXT        NOT NULL,
  predicted_runs  INT         NOT NULL,
  is_correct      BOOLEAN,
  points_awarded  INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, user_phone)
);

CREATE INDEX IF NOT EXISTS idx_ba_solli_pred_round
  ON ba_solli_adi_prediction (round_id);
