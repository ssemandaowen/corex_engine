CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Strategy Control (Integrity)
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,
  version_tag VARCHAR(20) NOT NULL,
  source_hash CHARACTER(64) NOT NULL,
  file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_versions_strategy_id ON strategy_versions(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_created_at ON strategy_versions(created_at DESC);

-- Ledger (Execution & Persistence)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES strategies(id),
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) CHECK (side IN ('BUY', 'SELL')),
  order_type VARCHAR(20) NOT NULL,
  quantity DECIMAL(18, 8) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_strategy_id ON orders(strategy_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  external_deal_id VARCHAR(100),
  fill_price DECIMAL(18, 8) NOT NULL,
  fill_quantity DECIMAL(18, 8) NOT NULL,
  commission DECIMAL(18, 8) DEFAULT 0,
  filled_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_fills_order_id ON order_fills(order_id);
CREATE INDEX IF NOT EXISTS idx_order_fills_filled_at ON order_fills(filled_at DESC);

CREATE TABLE IF NOT EXISTS positions (
  symbol VARCHAR(20) PRIMARY KEY,
  net_quantity DECIMAL(18, 8) NOT NULL,
  avg_price DECIMAL(18, 8) NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Bridge Audit (Telemetry)
CREATE TABLE IF NOT EXISTS mt5_messages (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  direction VARCHAR(10) CHECK (direction IN ('IN', 'OUT')),
  raw_payload JSONB NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mt5_messages_order_id ON mt5_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_mt5_messages_timestamp ON mt5_messages(timestamp DESC);
