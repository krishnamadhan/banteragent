-- ============================================================
-- Migration 002 — mode + member tracking
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add bot_mode to group settings
ALTER TABLE ba_group_settings
  ADD COLUMN IF NOT EXISTS bot_mode TEXT DEFAULT 'roast'
  CHECK (bot_mode IN ('roast', 'friendly', 'savage'));

-- 2. All group members (including silent ones who never chat)
CREATE TABLE IF NOT EXISTS ba_group_members (
  group_id     TEXT NOT NULL,
  member_phone TEXT NOT NULL,
  member_name  TEXT NOT NULL,
  last_seen    TIMESTAMPTZ,
  synced_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, member_phone)
);
