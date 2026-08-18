-- Tracks active sessions for server-side sign-out revocation.

BEGIN;

CREATE TABLE IF NOT EXISTS corex_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON corex_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON corex_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON corex_sessions(revoked_at)
    WHERE revoked_at IS NOT NULL;

COMMIT;
