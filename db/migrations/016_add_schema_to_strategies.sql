-- db/migrations/016_add_schema_to_strategies.sql
-- Add schema support for TradingView-style param tuning

BEGIN;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS schema JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;