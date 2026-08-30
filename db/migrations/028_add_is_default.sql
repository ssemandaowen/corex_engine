-- Add is_default to trading_accounts and backfill.
--
-- Backfill logic: for each user, mark the earliest-created trading_account
-- (by created_at ASC) as is_default = true. All others remain false.
-- This is a one-time backfill, not runtime logic.

BEGIN;

ALTER TABLE trading_accounts
    ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_default
    ON trading_accounts(user_id, is_default) WHERE is_default = true;

-- Backfill: mark each user's earliest account as default.
-- Uses a correlated subquery with created_at ordering.
UPDATE trading_accounts AS t
SET is_default = true
WHERE t.account_id IN (
    SELECT DISTINCT ON (user_id) account_id
    FROM trading_accounts
    ORDER BY user_id, created_at ASC
);

COMMIT;
