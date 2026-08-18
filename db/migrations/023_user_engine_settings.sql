-- Part 1.5 + Plan 2 Part 5: user-scoped engine settings.
-- Per-user default PAPER balance, risk limits, timeframe, notifications.

BEGIN;

CREATE TABLE IF NOT EXISTS user_engine_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    max_concurrent_strategies INTEGER NOT NULL DEFAULT 3,
    default_paper_balance NUMERIC(20,8) NOT NULL DEFAULT 100000,
    default_timeframe TEXT NOT NULL DEFAULT '1m',
    default_mode TEXT NOT NULL DEFAULT 'PAPER',
    risk_max_daily_loss_pct NUMERIC(5,2),
    risk_max_position_pct NUMERIC(5,2),
    notifications_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_engine_settings_user ON user_engine_settings(user_id);

COMMENT ON TABLE user_engine_settings IS 'Per-user execution defaults and risk limits for strategy runtime.';

COMMIT;
