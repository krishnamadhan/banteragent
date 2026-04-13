-- ============================================================
-- Migration 005 — Birthday wish tracking
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE ba_member_profiles
  ADD COLUMN IF NOT EXISTS last_wished_at DATE;
