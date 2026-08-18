-- db/migrations/20260613_drop_orphaned_backtest_table.sql
-- Drop orphaned table from migration 014 as it was replaced by backtest_uploads.

BEGIN;
DROP TABLE IF EXISTS backtest_data_storage;
COMMIT;
