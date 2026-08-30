-- Drop the duplicate `accounts` table and repoint `connections.account_id`
-- to reference `trading_accounts.account_id` instead.
--
-- Rationale: `accounts` (migration 026) was an empty, disconnected duplicate
-- of `trading_accounts` (migration 025). Nothing wrote to it except the unused
-- AccountsService.createAccount() path. The `connections` table's FK pointed
-- at the wrong table, causing PUT /api/settings/connectors/:type to 500 when
-- saving connector settings for a real account present in `trading_accounts`.

BEGIN;

DROP TABLE IF EXISTS accounts CASCADE;

ALTER TABLE connections
    DROP CONSTRAINT IF EXISTS connections_account_id_fkey;

ALTER TABLE connections
    ADD CONSTRAINT connections_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES trading_accounts(account_id);

COMMIT;
