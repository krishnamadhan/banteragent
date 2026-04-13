-- ============================================================
-- Migration 004 — Add nickname to member profiles
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE ba_member_profiles
  ADD COLUMN IF NOT EXISTS nickname TEXT;
