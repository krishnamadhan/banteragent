-- Add expires_at column to ba_question_archive for TTL-based dedup
-- NULL = permanent (static pool games), non-NULL = expires at that timestamp
ALTER TABLE ba_question_archive ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_ba_archive_expires ON ba_question_archive(expires_at) WHERE expires_at IS NOT NULL;
