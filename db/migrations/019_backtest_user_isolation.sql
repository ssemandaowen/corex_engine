-- Enforces per-user ownership of backtest reports.

BEGIN;

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'system';

CREATE INDEX IF NOT EXISTS idx_backtests_user_id ON backtests(user_id);
CREATE INDEX IF NOT EXISTS idx_backtests_user_created ON backtests(user_id, created_at DESC);

COMMENT ON COLUMN backtests.user_id IS
    'Owner of this backtest report. Never query without this filter.';

COMMIT;
