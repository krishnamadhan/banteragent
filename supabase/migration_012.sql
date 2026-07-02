-- ============================================================
-- migration_012.sql — Fantasy Ranking Points
--
-- Tracks per-match placement points:
--   1st place = N pts, 2nd = N-1, ..., last = 1  (N = participants)
-- First player to reach 100 cumulative pts wins ₹500 gift voucher.
--
-- No group_id — fantasy contests are shared across all groups.
-- ============================================================

CREATE TABLE IF NOT EXISTS ba_fantasy_ranking (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id       TEXT NOT NULL,
  match_label    TEXT NOT NULL,       -- "DC vs KKR"
  player_name    TEXT NOT NULL,       -- display_name from fantasy app
  rank           INT  NOT NULL,
  participants   INT  NOT NULL,
  points_awarded INT  NOT NULL,       -- participants - rank + 1
  awarded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent: re-running award for same match+player is a no-op
CREATE UNIQUE INDEX IF NOT EXISTS idx_ba_fantasy_ranking_match_player
  ON ba_fantasy_ranking(match_id, player_name);
