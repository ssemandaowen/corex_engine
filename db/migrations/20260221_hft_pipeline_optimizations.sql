-- HFT pipeline storage primitives for low-latency ingestion and analytics.

CREATE TABLE IF NOT EXISTS strategy_signals (
    id BIGSERIAL PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    intent TEXT NOT NULL,
    side TEXT NULL,
    quantity NUMERIC(18,8) NULL,
    mode TEXT NOT NULL DEFAULT 'PAPER',
    payload JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_lookup
    ON strategy_signals (strategy_id, symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_created
    ON strategy_signals (created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_ticks (
    ts TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    price NUMERIC(18,8) NOT NULL,
    volume NUMERIC(18,8) NULL,
    source TEXT NULL,
    payload JSONB NULL,
    PRIMARY KEY (symbol, ts)
) PARTITION BY RANGE (ts);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND c.relname = 'strategy_ticks_p0'
          AND n.nspname = current_schema()
    ) THEN
        EXECUTE '
            CREATE TABLE strategy_ticks_p0
            PARTITION OF strategy_ticks
            FOR VALUES FROM (''2020-01-01'') TO (''2030-01-01'')';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_strategy_ticks_ts ON strategy_ticks (ts DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_ticks_symbol_ts ON strategy_ticks (symbol, ts DESC);

CREATE TABLE IF NOT EXISTS execution_events (
    id BIGSERIAL PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    mode TEXT NOT NULL,
    event_type TEXT NOT NULL,
    latency_ms INTEGER NULL,
    status TEXT NOT NULL,
    details JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_events_lookup
    ON execution_events (strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_events_symbol
    ON execution_events (symbol, created_at DESC);

