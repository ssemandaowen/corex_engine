-- db/migrations/015_corex_runtime_isolation.sql
-- CoreX Runtime Isolation Schema

BEGIN;

-- 1. Create strategy runtimes tracker table
CREATE TABLE IF NOT EXISTS strategy_runtimes (
    runtime_id VARCHAR(255) PRIMARY KEY, -- "user_id::strategy_name::SYMBOL::MODE"
    user_id VARCHAR(100) NOT NULL,
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    runtime_mode VARCHAR(20) NOT NULL CHECK (runtime_mode IN ('BACKTEST', 'PAPER', 'LIVE')),
    actual_state VARCHAR(20) NOT NULL DEFAULT 'STOPPED' CHECK (actual_state IN ('ACTIVE', 'PAUSED', 'STOPPED')),
    params JSONB NOT NULL DEFAULT '{}', -- Shadow config store for immediate runtime updates
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Index hot-path query handles
CREATE INDEX IF NOT EXISTS idx_strategy_runtimes_symbol ON strategy_runtimes(symbol) WHERE actual_state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_strategy_runtimes_user ON strategy_runtimes(user_id);

-- 3. Align existing orders table with runtime tracking frames safely
ALTER TABLE orders ADD COLUMN IF NOT EXISTS runtime_id VARCHAR(255);

-- 4. Add foreign keys pointing orders to their execution instance sandbox
-- Note: Handled gracefully if database configurations run out-of-order
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_runtime_id'
    ) THEN
        ALTER TABLE orders 
        ADD CONSTRAINT fk_orders_runtime_id 
        FOREIGN KEY (runtime_id) REFERENCES strategy_runtimes(runtime_id) ON DELETE SET NULL;
    END IF;
END $$;

COMMIT;