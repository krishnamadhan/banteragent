-- Migration 009: Per-group fantasy state (composite PK)
-- Allows each WhatsApp group to independently track its own match lifecycle
-- (announced, toss notified, locked, completed) for the same match/contest.
--
-- Run in BanterAgent's Supabase SQL Editor BEFORE deploying the code update.

-- 1. Drop existing PK
ALTER TABLE ba_fantasy_state DROP CONSTRAINT ba_fantasy_state_pkey;

-- 2. Add composite PK: one row per (match, group)
ALTER TABLE ba_fantasy_state ADD PRIMARY KEY (match_id, group_id);

-- 3. Recreate active-state index
DROP INDEX IF EXISTS idx_fantasy_state_active;
CREATE INDEX IF NOT EXISTS idx_fantasy_state_active
  ON ba_fantasy_state(group_id, completed_at)
  WHERE completed_at IS NULL;
