CREATE TABLE accounts (
  account_id   TEXT PRIMARY KEY,   -- cx_pap_<ulid> / cx_liv_<ulid>
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('paper','live')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connections (
  connection_id   TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(account_id),
  connector_type  TEXT NOT NULL,
  credentials     JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, connector_type) -- FIXES DATA LOSS BUG
);
