ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS script_body TEXT,
  ADD COLUMN IF NOT EXISTS script_hash CHARACTER(64),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_strategies_updated_at ON strategies(updated_at DESC);
