-- User-scoped auth keys + per-user settings isolation.

CREATE TABLE IF NOT EXISTS user_system_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_broker_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  cash DOUBLE PRECISION NOT NULL DEFAULT 0,
  initial_cash DOUBLE PRECISION NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, mode)
);

CREATE TABLE IF NOT EXISTS user_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'default',
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_status ON user_api_keys(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_expires_at ON user_api_keys(expires_at);

ALTER TABLE backtests
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_backtests_user_created_at ON backtests(user_id, created_at DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_orders_user_environment_created_at ON orders(user_id, environment, created_at DESC);

ALTER TABLE paper_trades
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_paper_trades_user_created_at ON paper_trades(user_id, created_at DESC);

-- Move legacy unscoped strategy names under a default owner to avoid cross-user collisions.
WITH default_user AS (
  SELECT id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE strategies s
SET name = (SELECT id FROM default_user) || '::' || s.name
WHERE s.name NOT LIKE '%::%'
  AND EXISTS (SELECT 1 FROM default_user)
  AND NOT EXISTS (
    SELECT 1
    FROM strategies sx
    WHERE sx.name = (SELECT id FROM default_user) || '::' || s.name
  );

WITH default_user AS (
  SELECT id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE orders o
SET strategy_name = (SELECT id FROM default_user) || '::' || o.strategy_name
WHERE COALESCE(o.strategy_name, '') <> ''
  AND o.strategy_name NOT LIKE '%::%'
  AND EXISTS (SELECT 1 FROM default_user);

WITH default_user AS (
  SELECT id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE backtests b
SET strategy_name = (SELECT id FROM default_user) || '::' || b.strategy_name
WHERE COALESCE(b.strategy_name, '') <> ''
  AND b.strategy_name NOT LIKE '%::%'
  AND EXISTS (SELECT 1 FROM default_user);

WITH default_user AS (
  SELECT id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE paper_trades p
SET strategy_name = (SELECT id FROM default_user) || '::' || p.strategy_name
WHERE COALESCE(p.strategy_name, '') <> ''
  AND p.strategy_name NOT LIKE '%::%'
  AND EXISTS (SELECT 1 FROM default_user);

-- Backfill user ownership from scoped strategy_name (<userId>::<strategyId>).
UPDATE backtests
SET user_id = split_part(strategy_name, '::', 1)
WHERE user_id IS NULL
  AND strategy_name LIKE '%::%';

UPDATE orders
SET user_id = split_part(strategy_name, '::', 1)
WHERE user_id IS NULL
  AND strategy_name LIKE '%::%';

UPDATE paper_trades
SET user_id = split_part(strategy_name, '::', 1)
WHERE user_id IS NULL
  AND strategy_name LIKE '%::%';

-- Seed per-user settings from current global defaults when missing.
INSERT INTO user_system_settings (user_id, payload, updated_at)
SELECT u.id, s.payload, NOW()
FROM users u
CROSS JOIN LATERAL (
  SELECT payload
  FROM system_settings
  WHERE id = 1
  LIMIT 1
) s
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_broker_settings (user_id, mode, cash, initial_cash, config, updated_at)
SELECT u.id, b.mode, b.cash, b.initial_cash, b.config, NOW()
FROM users u
JOIN broker_settings b ON TRUE
ON CONFLICT (user_id, mode) DO NOTHING;
