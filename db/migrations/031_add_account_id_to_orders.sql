-- Add nullable account_id to orders and order_fills for account-scoped trade history.
-- Nullable because existing rows predate account_id; no backfill is performed.
-- New orders/fills will populate account_id when the caller has it available.
--
-- This enables corex-portfolio to key history by account_id while preserving
-- backward compatibility for legacy queries keyed by user_id + environment.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES trading_accounts(account_id);

ALTER TABLE order_fills
  ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES trading_accounts(account_id);

CREATE INDEX IF NOT EXISTS idx_orders_account_id
  ON orders(account_id);

CREATE INDEX IF NOT EXISTS idx_order_fills_account_id
  ON order_fills(account_id);

COMMIT;
