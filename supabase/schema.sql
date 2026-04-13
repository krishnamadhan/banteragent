-- ============================================
-- BanterAgent v3 — Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================

-- 1. Message Stats — tracks every message for analytics
CREATE TABLE ba_message_stats (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id      TEXT NOT NULL,
  sender_phone  TEXT NOT NULL,
  sender_name   TEXT NOT NULL,
  message_text  TEXT,
  word_count    INT DEFAULT 0,
  has_emoji     BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ba_message_stats_group   ON ba_message_stats(group_id);
CREATE INDEX idx_ba_message_stats_sender  ON ba_message_stats(sender_phone);
CREATE INDEX idx_ba_message_stats_created ON ba_message_stats(created_at);

-- 2. Game State — one active game per group at a time
CREATE TABLE ba_game_state (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   TEXT NOT NULL,
  game_type  TEXT NOT NULL, -- 'quiz','wyr','wordchain','antakshari','trivia','dialogue','songlyric'
  state      JSONB NOT NULL DEFAULT '{}',
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX idx_ba_game_active ON ba_game_state(group_id, is_active);

-- 3. Game Scores — current week only (reset every Monday 12 AM IST)
CREATE TABLE ba_game_scores (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id     TEXT NOT NULL,
  player_phone TEXT NOT NULL,
  player_name  TEXT NOT NULL,
  game_type    TEXT NOT NULL,
  points       INT DEFAULT 0,
  week_start   DATE NOT NULL DEFAULT CURRENT_DATE, -- Monday of current week (IST)
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_ba_game_scores_unique ON ba_game_scores(group_id, player_phone, game_type, week_start);
CREATE INDEX idx_ba_game_scores_week ON ba_game_scores(group_id, week_start);

-- 4. Game Scores All-Time — never reset, accumulates forever
CREATE TABLE ba_game_scores_alltime (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id     TEXT NOT NULL,
  player_phone TEXT NOT NULL,
  player_name  TEXT NOT NULL,
  game_type    TEXT NOT NULL,
  points       INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_ba_game_scores_alltime_unique ON ba_game_scores_alltime(group_id, player_phone, game_type);
CREATE INDEX idx_ba_game_scores_alltime_group ON ba_game_scores_alltime(group_id);

-- 5. Polls
CREATE TABLE ba_polls (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   TEXT NOT NULL,
  question   TEXT NOT NULL,
  options    JSONB NOT NULL DEFAULT '[]', -- [{text: "...", votes: 0}]
  votes      JSONB NOT NULL DEFAULT '{}', -- {phone: option_index}
  is_active  BOOLEAN DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ba_polls_active ON ba_polls(group_id, is_active);

-- 6. Reminders
CREATE TABLE ba_reminders (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id           TEXT NOT NULL,
  sender_phone       TEXT NOT NULL,
  sender_name        TEXT NOT NULL,
  reminder_text      TEXT NOT NULL,
  remind_at          TIMESTAMPTZ NOT NULL,
  is_group_reminder  BOOLEAN DEFAULT false,
  is_sent            BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ba_reminders_pending ON ba_reminders(is_sent, remind_at);

-- 7. Group Settings — feature toggles and bot config
CREATE TABLE ba_group_settings (
  group_id          TEXT PRIMARY KEY,
  -- Scheduled content toggles
  cricket_alerts    BOOLEAN DEFAULT false,
  morning_roast     BOOLEAN DEFAULT true,
  horoscope         BOOLEAN DEFAULT true,
  weekly_awards     BOOLEAN DEFAULT true,
  monthly_recap     BOOLEAN DEFAULT true,
  auto_game_drop    BOOLEAN DEFAULT true,  -- bot starts game when group quiet 2+ hrs
  -- Game toggles
  dialogue_game     BOOLEAN DEFAULT true,
  songlyric_game    BOOLEAN DEFAULT true,
  -- Bot behaviour
  muted             BOOLEAN DEFAULT false, -- !mute / !unmute
  auto_response     BOOLEAN DEFAULT true,  -- unprompted replies
  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Cricket State — dedup: one row per match being tracked
CREATE TABLE ba_cricket_state (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id       TEXT NOT NULL,
  match_id       TEXT NOT NULL,             -- cricapi match id
  last_score     TEXT,                      -- last score string sent (e.g. "IND 145/3 (15.2 ov)")
  last_sent_at   TIMESTAMPTZ DEFAULT NOW(),
  match_status   TEXT DEFAULT 'live',       -- 'live' | 'completed'
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_ba_cricket_state_match ON ba_cricket_state(group_id, match_id);

-- ============================================
-- Helper: Upsert weekly + alltime game score
-- ============================================
CREATE OR REPLACE FUNCTION ba_upsert_game_score(
  p_group_id     TEXT,
  p_player_phone TEXT,
  p_player_name  TEXT,
  p_game_type    TEXT,
  p_points       INT
)
RETURNS VOID AS $$
DECLARE
  v_week_start DATE := DATE_TRUNC('week', NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
BEGIN
  -- Update weekly scores
  INSERT INTO ba_game_scores (group_id, player_phone, player_name, game_type, points, week_start)
  VALUES (p_group_id, p_player_phone, p_player_name, p_game_type, p_points, v_week_start)
  ON CONFLICT (group_id, player_phone, game_type, week_start)
  DO UPDATE SET
    points      = ba_game_scores.points + p_points,
    player_name = p_player_name,
    updated_at  = NOW();

  -- Update all-time scores
  INSERT INTO ba_game_scores_alltime (group_id, player_phone, player_name, game_type, points)
  VALUES (p_group_id, p_player_phone, p_player_name, p_game_type, p_points)
  ON CONFLICT (group_id, player_phone, game_type)
  DO UPDATE SET
    points      = ba_game_scores_alltime.points + p_points,
    player_name = p_player_name,
    updated_at  = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Helper: Expire old games
-- ============================================
CREATE OR REPLACE FUNCTION ba_expire_old_games()
RETURNS VOID AS $$
BEGIN
  UPDATE ba_game_state
  SET is_active = false
  WHERE expires_at < NOW() AND is_active = true;
END;
$$ LANGUAGE plpgsql;
