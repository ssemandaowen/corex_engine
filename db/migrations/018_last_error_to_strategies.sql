-- Tracks compilation and runtime errors per strategy.

BEGIN;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

COMMIT;
