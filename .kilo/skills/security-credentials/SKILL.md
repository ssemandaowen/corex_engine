---
name: security-credentials
description: Security & Credentials
---


## Connector credentials
Per-user broker/connector credentials are AES-encrypted at rest. Any code path that reads them must
decrypt only in memory, only when needed, and must never log the decrypted value (not even at debug
level) or include it in an error message, audit log, or broadcast payload.

## Compile caching
Strategy compile cache keys are SHA256 hashes of source — this is a content-integrity mechanism as
well as a performance one. Don't weaken it to a non-cryptographic hash or a mutable cache key.

## Session security
Session revocation is server-side via `corex_sessions` — see `08-state-persistence-and-recovery.md`.
Never introduce a "trust the client" shortcut for auth state.

## General
- Never commit or suggest committing real API keys/secrets in any file this agent creates.
- Treat `.env*` files and anything under `secrets/` as off-limits for automatic edits (also
  enforced at the `kilo.jsonc` permission layer) — read only when explicitly asked, and never echo
  their contents back into chat, logs, or generated files.



