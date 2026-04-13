-- Migration 007: IPL Fantasy integration state tracking
-- Run in BanterAgent's Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ba_fantasy_state (
  match_id         text PRIMARY KEY,   -- f11_matches.id from the fantasy app
  group_id         text NOT NULL,       -- WhatsApp group JID
  contest_id       text,               -- f11_contests.id
  invite_code      text,               -- private contest invite code
  team_home        text,
  team_away        text,
  scheduled_at     timestamptz,
  announced_at     timestamptz,        -- when the bot dropped the match announcement
  toss_notified_at timestamptz,        -- when the bot sent playing XI
  locked_at        timestamptz,        -- when the bot/admin locked the match
  completed_at     timestamptz,        -- when match ended
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fantasy_state_group ON ba_fantasy_state(group_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_state_active ON ba_fantasy_state(group_id, completed_at)
  WHERE completed_at IS NULL;
