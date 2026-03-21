-- Persist backtest uploads and fetched market datasets in Postgres.
-- This lets maintenance/culling manage data lifecycle centrally.

CREATE TABLE IF NOT EXISTS backtest_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  original_name TEXT,
  ext TEXT,
  dedup_path TEXT,
  symbol_path TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  bars_count INTEGER,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_uploads_user_symbol_digest
  ON backtest_uploads(user_id, symbol, digest);
CREATE INDEX IF NOT EXISTS idx_backtest_uploads_user_created_at
  ON backtest_uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_uploads_last_used_at
  ON backtest_uploads(last_used_at DESC);

CREATE TABLE IF NOT EXISTS backtest_market_data (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'twelvedata',
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  outputsize INTEGER NOT NULL DEFAULT 0,
  range_mode TEXT NOT NULL DEFAULT 'points',
  range_start BIGINT,
  range_end BIGINT,
  bars_count INTEGER NOT NULL DEFAULT 0,
  bars JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_market_data_user_created_at
  ON backtest_market_data(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_market_data_symbol_tf
  ON backtest_market_data(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_market_data_last_used_at
  ON backtest_market_data(last_used_at DESC);
