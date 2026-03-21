-- Postgres-backed job queue for long-running work (backtests, reconciliation, etc.).

CREATE TABLE IF NOT EXISTS corex_jobs (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corex_jobs_status_run_at ON corex_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_corex_jobs_user_created_at ON corex_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corex_jobs_type_status ON corex_jobs(type, status);

