-- Unify execution history for PAPER/LIVE analytics and visualization.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS intent TEXT CHECK (intent IN ('ENTER', 'EXIT')),
  ADD COLUMN IF NOT EXISTS sl DECIMAL(18, 8),
  ADD COLUMN IF NOT EXISTS tp DECIMAL(18, 8);

CREATE INDEX IF NOT EXISTS idx_orders_environment_created_at ON orders(environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_strategy_name_created_at ON orders(strategy_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_environment_symbol_created_at ON orders(environment, symbol, created_at DESC);

ALTER TABLE paper_trades
  ADD COLUMN IF NOT EXISTS order_id UUID,
  ADD COLUMN IF NOT EXISTS fill_price DECIMAL(18, 8),
  ADD COLUMN IF NOT EXISTS commission DECIMAL(18, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'PAPER' CHECK (environment IN ('PAPER', 'LIVE'));

CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy_symbol_created_at
  ON paper_trades(strategy_name, symbol, created_at DESC);
