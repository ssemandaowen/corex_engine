-- Verification script for migration 029.
--
-- Run against a test database AFTER migrations 025–029 have been applied.
-- Proves: each user has exactly one default account per type (paper/live),
-- never zero when at least one account of that type exists, never more than one.
--
-- Usage: psql -d corex_test -f db/migrations/029_verify.sql

BEGIN;

-- Setup: isolate in a transaction that we roll back at the end.
SAVEPOINT verify_start;

-- Clean slate for verification (idempotent).
DELETE FROM connections WHERE account_id LIKE 'cx_verify_%';
DELETE FROM trading_accounts WHERE user_id LIKE 'verify_user_%';
DELETE FROM users WHERE id LIKE 'verify_user_%';

-- Seed test users (needed for FK trading_accounts_user_id_fkey).
INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at)
VALUES
    ('verify_user_mixed',   'verify_mixed@test.local',   'Verify Mixed',   'user', 'active', 'x', now(), now()),
    ('verify_user_single',  'verify_single@test.local',  'Verify Single',  'user', 'active', 'x', now(), now());

-- Seed: user with one paper + one live account (simulates pre-existing data).
INSERT INTO trading_accounts (account_id, user_id, type, label, is_default, status, created_at, updated_at)
VALUES
    ('cx_verify_paper_1', 'verify_user_mixed', 'paper', 'Paper Account', false, 'active', '2026-01-01'::timestamptz, now()),
    ('cx_verify_live_1', 'verify_user_mixed', 'live',  'Live Account',  false, 'active', '2026-02-01'::timestamptz, now());

-- Seed: user with only a single paper account (common case — must not regress).
INSERT INTO trading_accounts (account_id, user_id, type, label, is_default, status, created_at, updated_at)
VALUES
    ('cx_verify_single_paper', 'verify_user_single', 'paper', 'Only Paper', false, 'active', '2026-03-01'::timestamptz, now());

-- Simulate migration 028's incorrect backfill (DISTINCT ON user_id): only earliest becomes default.
UPDATE trading_accounts SET is_default = false;
UPDATE trading_accounts SET is_default = true
WHERE account_id IN (
    SELECT DISTINCT ON (user_id) account_id
    FROM trading_accounts
    WHERE user_id LIKE 'verify_user_%'
    ORDER BY user_id, created_at ASC
);

-- Confirm pre-condition: mixed user has exactly one default (paper), live is NOT default.
DO $$
DECLARE
    paper_defaults INTEGER;
    live_defaults INTEGER;
    single_defaults INTEGER;
    same_type_dupes INTEGER;
BEGIN
    SELECT COUNT(*) INTO paper_defaults
    FROM trading_accounts
    WHERE user_id = 'verify_user_mixed' AND type = 'paper' AND is_default = true;

    SELECT COUNT(*) INTO live_defaults
    FROM trading_accounts
    WHERE user_id = 'verify_user_mixed' AND type = 'live' AND is_default = true;

    ASSERT paper_defaults = 1, 'PRE-CONDITION FAIL: mixed user should have 1 paper default after 028';
    ASSERT live_defaults = 0, 'PRE-CONDITION FAIL: mixed user should have 0 live defaults after 028 (this is the bug)';

    -- Now apply migration 029's correction.
    UPDATE trading_accounts SET is_default = false WHERE is_default = true;

    UPDATE trading_accounts AS t
    SET is_default = true
    WHERE t.account_id IN (
        SELECT DISTINCT ON (user_id, type) account_id
        FROM trading_accounts
        WHERE user_id LIKE 'verify_user_%'
        ORDER BY user_id, type, created_at ASC
    );

    -- TEST 1: mixed user now has BOTH paper and live default.
    SELECT COUNT(*) INTO paper_defaults
    FROM trading_accounts
    WHERE user_id = 'verify_user_mixed' AND type = 'paper' AND is_default = true;

    SELECT COUNT(*) INTO live_defaults
    FROM trading_accounts
    WHERE user_id = 'verify_user_single' AND type = 'paper' AND is_default = true;

    ASSERT paper_defaults = 1, 'TEST 1 FAIL: mixed user should have 1 paper default after 029';

    SELECT COUNT(*) INTO live_defaults
    FROM trading_accounts
    WHERE user_id = 'verify_user_mixed' AND type = 'live' AND is_default = true;

    ASSERT live_defaults = 1, 'TEST 1 FAIL: mixed user should have 1 live default after 029';

    -- TEST 2: single-account user still has exactly one default (no regression).
    SELECT COUNT(*) INTO single_defaults
    FROM trading_accounts
    WHERE user_id = 'verify_user_single' AND is_default = true;

    ASSERT single_defaults = 1, 'TEST 2 FAIL: single-account user should still have 1 default after 029';

    -- TEST 3: no user has two defaults of the same type.
    SELECT COUNT(*) INTO same_type_dupes
    FROM (
        SELECT user_id, type, COUNT(*) AS n
        FROM trading_accounts
        WHERE user_id LIKE 'verify_user_%' AND is_default = true
        GROUP BY user_id, type
        HAVING COUNT(*) > 1
    ) dupes;

    ASSERT same_type_dupes = 0, 'TEST 3 FAIL: no user should have two defaults of the same type after 029';

    RAISE NOTICE 'ALL TESTS PASSED';
END $$;

-- Tear down verification data.
ROLLBACK TO SAVEPOINT verify_start;

COMMIT;
