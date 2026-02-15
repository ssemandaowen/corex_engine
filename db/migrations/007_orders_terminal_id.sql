ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS terminal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_terminal_id ON orders(terminal_id);
