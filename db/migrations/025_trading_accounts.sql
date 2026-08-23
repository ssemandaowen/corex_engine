-- Trading accounts for Socket_X protocol layer.
-- Supports structured account IDs (cx_pap_<ulid> / cx_liv_<ulid>),
-- per-user account limits, and broker binding for live accounts.

BEGIN;

CREATE TABLE IF NOT EXISTS trading_accounts (
    account_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('paper', 'live')),
    label TEXT,
    broker_binding JSONB,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_id ON trading_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_type ON trading_accounts(user_id, type) WHERE status = 'active';

COMMIT;