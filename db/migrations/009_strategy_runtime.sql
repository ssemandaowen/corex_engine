-- Strategy runtime state persisted in DB (mode + params)
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS runtime_mode TEXT NOT NULL DEFAULT 'PAPER',
  ADD COLUMN IF NOT EXISTS runtime_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS runtime_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE strategies
SET runtime_mode = COALESCE(runtime_mode, 'PAPER'),
    runtime_params = COALESCE(runtime_params, '{}'::jsonb),
    runtime_updated_at = COALESCE(runtime_updated_at, NOW());
