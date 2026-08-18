-- Cache strategy compile metadata so boot can skip unchanged source.

BEGIN;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS compiled_hash TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS compiled_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_strategies_compiled_hash ON strategies(compiled_hash);

COMMIT;
