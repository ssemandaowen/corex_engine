-- Fix is_default backfill: scope per (user_id, type), not per user_id alone.
--
-- Migration 028 used DISTINCT ON (user_id), marking exactly one account per user
-- as default regardless of type. But create() treats default as per-(user, type):
-- the first account of each type is auto-defaulted. So a user with both a paper
-- and a live account ended up with only the earlier-created one marked default;
-- the other type had no default at all.
--
-- This migration clears 028's result and re-applies correctly: one default per
-- (user_id, type), earliest created_at wins within each group.

BEGIN;

-- 1. Clear the incorrect defaults set by 028's backfill.
UPDATE trading_accounts SET is_default = false WHERE is_default = true;

-- 2. Re-apply correctly, scoped per (user_id, type).
UPDATE trading_accounts AS t
SET is_default = true
WHERE t.account_id IN (
    SELECT DISTINCT ON (user_id, type) account_id
    FROM trading_accounts
    ORDER BY user_id, type, created_at ASC
);

COMMIT;
