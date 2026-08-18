-- Stores per-user encrypted connector credentials and non-secret config.

BEGIN;

CREATE TABLE IF NOT EXISTS user_connector_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    connector_type TEXT NOT NULL,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    encrypted_secrets JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, connector_type)
);

CREATE INDEX IF NOT EXISTS idx_user_connector_user ON user_connector_settings(user_id);

COMMENT ON COLUMN user_connector_settings.encrypted_secrets IS
    'AES-256 encrypted secret values from secretsVault. Never store plaintext.';
COMMENT ON COLUMN user_connector_settings.config_json IS
    'Non-secret connector configuration such as accountId, region, host, and port.';

COMMIT;
