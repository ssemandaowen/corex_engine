-- Persist desired strategy runtime state to support restart recovery.
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS runtime_state TEXT NOT NULL DEFAULT 'STOPPED';

UPDATE strategies
SET runtime_state = CASE
    WHEN UPPER(COALESCE(runtime_state, '')) IN ('RUNNING', 'STOPPED') THEN UPPER(runtime_state)
    ELSE 'STOPPED'
END;
