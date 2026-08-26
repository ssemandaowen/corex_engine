# corex-auth

**CoreX Auth Layer** — JWT signing/verification (AuthService), AES-256-GCM encryption (SecretsVault).

**Version:** 2026.1.21

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Features](#features)
  - [AuthService — JWT \& Password Hashing](#authservice--jwt--password-hashing)
  - [SecretsVault — AES-256-GCM Encryption](#secretsvault---aes-256-gcm-encryption)
- [Environment Variables](#environment-variables)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Consumers](#consumers)
- [Testing](#testing)
- [Boundaries \& Conventions](#boundaries--conventions)

---

## Overview

`corex-auth` is the canonical authentication and secrets management package for the CoreX trading engine. It provides:

1. **AuthService** — HMAC-SHA256 JWT signing/verification + scrypt password hashing
2. **SecretsVault** — AES-256-GCM authenticated encryption for at-rest secrets with key rotation support

**Design Principles:**
- **Pure-logic package** — no Express.js, no PostgreSQL, no external dependencies
- **Self-contained** — portable, testable in isolation
- **Single source of truth** — all JWT verification in CoreX flows through this package

---

## Installation

```bash
npm install
```

### Dependencies

None. Uses only Node.js built-in `crypto` module.

---

## Features

### AuthService — JWT & Password Hashing

AuthService handles all token-based authentication and password security for CoreX.

#### How It Works

**JWT Tokens (HMAC-SHA256):**
- Tokens are signed with a secret key (`JWT_SECRET` env var)
- 30-day TTL by default (configurable via `AUTH_TOKEN_TTL_SEC`)
- Standard JWT structure: `header.payload.signature`
- Base64Url encoding with SHA-256 HMAC

**Password Hashing (scrypt):**
- Uses scrypt with parameters N=16384, r=8, p=1
- Random 16-byte salt per password
- 64-byte derived key
- Format: `salt:hash` stored in database
- Timing-safe comparison via `crypto.timingSafeEqual`

#### Token Lifecycle

```
Sign-in → signToken({ userId, role }) → JWT sent to client
                                    ↓
Client stores JWT → sends with each request
                                    ↓
Server → verifyToken(jwt) → { userId, role, iat, exp } or throws
```

#### Error Handling

| Error | Meaning |
|-------|---------|
| `TOKEN_MISSING` | No token provided |
| `TOKEN_INVALID` | Malformed JWT (wrong number of parts) |
| `TOKEN_SIGNATURE_INVALID` | Signature mismatch (wrong secret) |
| `TOKEN_EXPIRED` | Token past expiration |

---

### SecretsVault — AES-256-GCM Encryption

SecretsVault provides authenticated encryption for sensitive configuration values (API keys, broker credentials, tokens).

#### How It Works

**Encryption (AES-256-GCM):**
- 12-byte random IV per encryption
- 16-byte authentication tag (integrity protection)
- Additional Authenticated Data (AAD) bound to ciphertext
- Format: `enc:v1:<iv_base64>:<ciphertext_base64>:<tag_base64>`

**Key Management:**
- Current key: `COREX_SECRETS_KEY` (required for encrypt/decrypt)
- Previous key: `COREX_SECRETS_KEY_OLD` (optional, for rotation reads)
- Legacy alias: `COREX_MASTER_KEY` (deprecated, mapped to current)
- Keys cached at startup; call `reloadKeys()` to refresh

**Key Rotation:**
1. Set `COREX_SECRETS_KEY_OLD` to the current key
2. Set `COREX_SECRETS_KEY` to the new key
3. Call `reloadKeys()`
4. Old ciphertexts remain readable (decryption tries both keys)
5. New encryptions use only the current key
6. Use `rotateObjectSecrets()` to migrate old ciphertexts

#### Encryption Lifecycle

```
plaintext → encryptString() → "enc:v1:<iv>:<ciphertext>:<tag>"
                                    ↓
Store in database / config file
                                    ↓
retrieve → decryptString() → plaintext (or throws DecryptionError)
```

#### Safety Features

| Behavior | Purpose |
|----------|---------|
| Already-encrypted values are not double-encrypted | Prevents corruption |
| Empty strings are not encrypted (warns instead) | Avoids false security |
| Plaintext passthrough for non-prefixed values | Graceful degradation |
| Typed `DecryptionError` on failure | Callers handle explicitly |
| AAD-bound cipher context | Prevents ciphertext reuse across contexts |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes (production) | HMAC signing key for JWTs |
| `COREX_SECRETS_KEY` | Yes (production) | AES-256 encryption key (32 bytes as hex or base64) |
| `COREX_SECRETS_KEY_OLD` | No | Previous key for rotation reads |
| `AUTH_TOKEN_TTL_SEC` | No | JWT lifetime in seconds (default: 2592000 = 30 days) |
| `ADMIN_SECRET` | No | Fallback for `JWT_SECRET` in development |

### Key Format

`COREX_SECRETS_KEY` accepts:
- 64-character hex string
- 44-character base64 string
- `hex:<value>` prefixed
- `base64:<value>` prefixed

---

## Usage

### Basic Setup

```javascript
const {
    AuthService,
    SecretsVault,
    signToken,
    verifyToken,
    hashPassword,
    verifyPassword,
    encryptString,
    decryptString,
} = require("corex-auth");
```

### JWT Authentication

```javascript
// Sign a token
const token = signToken({ userId: "user_123", role: "trader" });

// Verify a token
try {
    const payload = verifyToken(token);
    console.log(payload.userId); // "user_123"
} catch (err) {
    console.error(err.message); // TOKEN_EXPIRED, TOKEN_INVALID, etc.
}
```

### Password Hashing

```javascript
// Hash a password (store this in the database)
const hash = await hashPassword("user-password");

// Verify a password
const isValid = await verifyPassword("user-password", hash);
if (isValid) {
    // Authentication successful
}
```

### Secrets Encryption

```javascript
// Encrypt a secret before storing
const encrypted = encryptString("my-api-key-12345");
// Store `encrypted` in database

// Decrypt when needed
const plaintext = decryptString(encrypted);
console.log(plaintext); // "my-api-key-12345"
```

### Object-Level Encryption

```javascript
const config = {
    name: "My Config",
    apiKey: "secret-key",
    region: "us-east",
};

// Encrypt specific fields
const encrypted = SecretsVault.encryptObjectSecrets(config, ["apiKey"]);

// Decrypt specific fields
const decrypted = SecretsVault.decryptObjectSecrets(encrypted, ["apiKey"]);

// Mask for logging (safe to pass to loggers)
const masked = SecretsVault.maskSecrets(config, ["apiKey"]);
// { name: "My Config", apiKey: "<redacted>", region: "us-east" }
```

### Key Rotation

```javascript
// 1. Set new key in env
// COREX_SECRETS_KEY = new_key
// COREX_SECRETS_KEY_OLD = current_key

// 2. Reload keys
SecretsVault.reloadKeys();

// 3. Migrate existing ciphertexts
const migrated = SecretsVault.rotateObjectSecrets(storedObject, ["apiKey"]);
```

---

## API Reference

### AuthService

| Function | Signature | Description |
|----------|-----------|-------------|
| `signToken` | `(payload, secret?, expiresInSec?) → string` | Create a signed JWT |
| `verifyToken` | `(token, secret?) → payload` | Verify and decode a JWT |
| `hashPassword` | `(password, salt?) → Promise<string>` | Hash password with scrypt |
| `verifyPassword` | `(password, hash) → Promise<boolean>` | Verify password against hash |

### SecretsVault

| Function | Signature | Description |
|----------|-----------|-------------|
| `encryptString` | `(plaintext) → string` | Encrypt a single value |
| `decryptString` | `(value) → string` | Decrypt a single value |
| `isEncryptedString` | `(value) → boolean` | Check if value is encrypted |
| `encryptObjectSecrets` | `(obj, paths?) → object` | Encrypt specified fields |
| `decryptObjectSecrets` | `(obj, paths?) → object` | Decrypt specified fields |
| `maskSecrets` | `(obj, paths?) → object` | Clone with secrets redacted |
| `rotateObjectSecrets` | `(obj, paths?) → object` | Re-encrypt under current key |
| `reloadKeys` | `() → keyCache` | Refresh key cache from env |
| `validateKeyConfig` | `(opts?) → boolean` | Validate key is configured |

### Constants

| Export | Description |
|--------|-------------|
| `PREFIX` | Encrypted value prefix: `enc:v1:` |
| `DEFAULT_SECRET_PATHS` | Default paths treated as secrets |
| `DecryptionError` | Typed error class for decryption failures |

---

## Consumers

`corex-auth` is the **canonical JWT source** for CoreX. All other packages consume it:

| Consumer | How It Uses corex-auth |
|----------|------------------------|
| `corex-broker-contract` Socket_X | Verifier injected via `SocketXServer.setAuthVerifier()` at startup |
| `engine/middleware/authGuard.js` | Direct `verifyToken()` calls for Express middleware |
| `engine/services/authService.js` | Re-export shim → `corex-auth/src/AuthService.js` |
| `engine/services/secretsVault.js` | Re-export shim → `corex-auth/src/SecretsVault.js` |

### Re-export Shims

Existing code using `@core/services/authService` or `@core/services/secretsVault` continues to work unchanged:

```javascript
// engine/services/authService.js — 10-line shim
module.exports = require("../../packages/corex-auth/src/AuthService");

// engine/services/secretsVault.js — 10-line shim
module.exports = require("../../packages/corex-auth/src/SecretsVault");
```

---

## Testing

```bash
npm test
```

**Configuration:** Jest with `--passWithNoTests --testTimeout=20000`

### Test Coverage (23 tests)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `AuthService.test.js` | 11 | JWT sign/verify, wrong secret, expired tokens, malformed tokens, default secret, password hash/verify, wrong password, salt uniqueness |
| `SecretsVault.test.js` | 12 | Encrypt/decrypt, key rotation, object helpers, tamper detection, key validation |

### Running Specific Tests

```bash
npm test -- --testNamePattern="signToken"
npm test -- --testPathPattern="SecretsVault"
```

---

## Boundaries & Conventions

### Do Not Violate Without Asking Owen

- `JWT_SECRET` must be set via environment variable — never hardcode or commit
- `COREX_SECRETS_KEY` must be set via environment variable — never hardcode or commit
- AuthService and SecretsVault must remain pure-logic — no DB, no Express, no external API calls
- The 30-day JWT TTL is intentional for "stay logged in" UX — do not reduce without approval
- Session revocation via `corex_sessions` table is handled in `engine/middleware/authGuard.js` (DB-coupled code stays in engine)

### Namespace

- This package owns all JWT verification logic in CoreX
- Other packages must NOT implement their own JWT verification — they must inject or call AuthService
- The `_defaultVerifyToken()` fallback in `corex-broker-contract` delegates to this package (not a duplicate)

### Human Verification Required

- **AuthService:** Test with real `JWT_SECRET` to verify token signing/verification round-trip
- **SecretsVault:** Test with real `COREX_SECRETS_KEY` to verify encrypt/decrypt round-trip and key rotation

---

## License

Proprietary — Apex Trait Ltd.