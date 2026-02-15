CREATE TABLE IF NOT EXISTS bridge_status (
  terminal_id TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_status_last_seen ON bridge_status(last_seen DESC);
