-- ============================================================
-- db/migrations/017_strategy_isolation.sql
-- ============================================================
-- Adds user_id ownership to strategies table.
-- The schema column already exists from migration 016 but
-- may have been applied without user_id. Safe to re-apply.
-- ============================================================
BEGIN;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'system';
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS schema JSONB;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS schema_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_strategies_user_id   ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_user_name ON strategies(user_id, name);

COMMENT ON COLUMN strategies.user_id IS
    'Owner of this strategy. All queries must be scoped to this field.';
COMMENT ON COLUMN strategies.schema IS
    'Extracted defineSchema() output — refreshed each time code is saved. Drives UI param rendering.';

COMMIT;


-- ============================================================
-- db/migrations/018_last_error_to_strategies.sql
-- ============================================================
-- Tracks compilation and runtime errors per strategy.
-- Moved from engine/018_add_last_error_to_strategies.sql
-- which was in the wrong directory.
-- ============================================================
BEGIN;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS last_error      TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS last_error_at   TIMESTAMPTZ;

COMMIT;


-- ============================================================
-- db/migrations/019_backtest_user_isolation.sql
-- ============================================================
-- Enforces per-user ownership of backtest reports.
-- ============================================================
BEGIN;

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'system';

CREATE INDEX IF NOT EXISTS idx_backtests_user_id      ON backtests(user_id);
CREATE INDEX IF NOT EXISTS idx_backtests_user_created ON backtests(user_id, created_at DESC);

COMMENT ON COLUMN backtests.user_id IS
    'Owner of this backtest report. Never query without this filter.';

COMMIT;


-- ============================================================
-- db/migrations/020_sessions.sql
-- ============================================================
-- Tracks active sessions for proper server-side sign-out.
-- JWT tokens alone cannot be revoked — this table enables it.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS corex_sessions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   TEXT        NOT NULL UNIQUE,
    user_id      TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ,
    ip_address   TEXT,
    user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON corex_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON corex_sessions(session_id);

-- Cleanup index: prune old revoked sessions
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON corex_sessions(revoked_at)
    WHERE revoked_at IS NOT NULL;

COMMIT;


-- ============================================================
-- db/migrations/021_user_connector_settings.sql
-- ============================================================
-- Per-user encrypted connector credentials.
-- API keys for TwelveData, MetaAPI, MT5 bridge, OANDA.
-- The encrypted_secrets column stores AES blobs from secretsVault.
-- Plaintext keys must NEVER be stored here.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS user_connector_settings (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT        NOT NULL,
    connector_type    TEXT        NOT NULL,   -- 'twelvedata' | 'metaapi' | 'mt5_bridge' | 'oanda'
    config_json       JSONB       NOT NULL DEFAULT '{}',
    encrypted_secrets JSONB,                  -- AES-256 encrypted blobs, one per secret key
    is_active         BOOLEAN     NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, connector_type)
);

CREATE INDEX IF NOT EXISTS idx_user_connector_user ON user_connector_settings(user_id);

COMMENT ON COLUMN user_connector_settings.encrypted_secrets IS
    'AES-256 encrypted secret values from secretsVault. Never store plaintext.';
COMMENT ON COLUMN user_connector_settings.config_json IS
    'Non-secret connector configuration (accountId, region, host, port etc).';

COMMIT;