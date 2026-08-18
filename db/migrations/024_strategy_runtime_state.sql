-- Migration 024: Add runtime_state_data column to strategies table
-- This stores persistent state for the this.state API in BaseStrategy.
-- Values survive server restarts and crashes.
-- Written: Round 7 fix.

ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS runtime_state_data JSONB DEFAULT '{}';

-- Index for faster lookups when restoring state on boot
CREATE INDEX IF NOT EXISTS idx_strategies_runtime_state
    ON strategies USING gin (runtime_state_data)
    WHERE runtime_state_data != '{}';

COMMENT ON COLUMN strategies.runtime_state_data IS
    'Persistent key-value store for BaseStrategy.this.state. Survives restarts.';
