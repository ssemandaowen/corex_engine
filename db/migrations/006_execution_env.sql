-- Orders environment + execution control + paper trades
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('PAPER','LIVE'));

UPDATE orders SET environment = 'LIVE' WHERE environment IS NULL;

CREATE TABLE IF NOT EXISTS execution_control (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  execution_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO execution_control (id, execution_enabled)
VALUES (1, TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT,
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) CHECK (side IN ('BUY','SELL')),
  quantity DECIMAL(18,8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'FILLED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_created_at ON paper_trades(created_at DESC);
