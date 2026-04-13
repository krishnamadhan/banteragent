-- Migration 008: Persistent question archive in Supabase
-- Ensures no question repeats even after bot restarts / redeployment

CREATE TABLE IF NOT EXISTS ba_question_archive (
  id          BIGSERIAL PRIMARY KEY,
  group_id    TEXT NOT NULL,
  game_type   TEXT NOT NULL,
  answer      TEXT NOT NULL,
  used_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, game_type, answer)
);

CREATE INDEX IF NOT EXISTS idx_qa_group_game ON ba_question_archive (group_id, game_type);
