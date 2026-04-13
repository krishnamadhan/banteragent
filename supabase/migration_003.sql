-- ============================================================
-- Migration 003 — Member profiles (zodiac, birthday, job, partner)
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS ba_member_profiles (
  group_id        TEXT NOT NULL,
  member_phone    TEXT NOT NULL,
  member_name     TEXT NOT NULL,
  zodiac_sign     TEXT,
  birthday        TEXT,
  occupation      TEXT,
  partner_name    TEXT,
  partner_phone   TEXT,
  facts           TEXT[],
  asked_zodiac_at TIMESTAMPTZ,
  last_updated    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, member_phone)
);

-- Index for fast per-group lookups
CREATE INDEX IF NOT EXISTS idx_ba_member_profiles_group
  ON ba_member_profiles (group_id);
