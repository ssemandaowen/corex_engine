"use strict";

/**
 * secretsManager.js
 *
 * AES-256-GCM authenticated encryption for at-rest secrets.
 *
 * Key env vars:
 *   COREX_SECRETS_KEY      — current encryption key (required for encrypt/decrypt)
 *   COREX_SECRETS_KEY_OLD  — previous key for rotation reads (optional)
 *   COREX_MASTER_KEY       — legacy alias for COREX_SECRETS_KEY
 *
 * Key format: 32-byte value as hex (64 chars), base64 (44 chars),
 *             or prefixed "hex:<...>" / "base64:<...>".
 *
 * Cipher: AES-256-GCM, 12-byte random IV, 16-byte auth tag, AAD-bound.
 */

const crypto = require("crypto");

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENT_VERSION = "v1";
const PREFIX          = `enc:${CURRENT_VERSION}:`;
const AAD             = "corex:secrets:v1";
const IV_BYTES        = 12;
const TAG_BYTES       = 16;
const KEY_BYTES       = 32;

// ─── Typed error ─────────────────────────────────────────────────────────────

/**
 * Thrown when decryption fails (wrong key, tampered ciphertext, bad format).
 * Callers must handle this explicitly — we never silently return ciphertext
 * as if it were plaintext.
 */
class DecryptionError extends Error {
    constructor(message, cause) {
        super(message);
        this.name  = "DecryptionError";
        this.cause = cause ?? null;
    }
}

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Normalise a raw key string → 32-byte Buffer, or null if invalid.
 * Accepts: 64-char hex, 44-char base64, "hex:<...>", "base64:<...>".
 */
function _normalizeKey(raw) {
    const v = String(raw || "").trim();
    if (!v) return null;

    let bytes;
    try {
        const lowered = v.toLowerCase();
        if (lowered.startsWith("hex:")) {
            bytes = Buffer.from(v.slice(4), "hex");
        } else if (lowered.startsWith("base64:")) {
            bytes = Buffer.from(v.slice(7), "base64");
        } else if (/^[0-9a-f]{64}$/i.test(v)) {
            bytes = Buffer.from(v, "hex");
        } else {
            bytes = Buffer.from(v, "base64");
        }
    } catch {
        return null;
    }

    return bytes.length === KEY_BYTES ? bytes : null;
}

/**
 * Module-level key cache.
 * Keys are read once and cached. Call `reloadKeys()` if env vars change
 * at runtime (e.g. in tests or after a config reload).
 *
 * _keyCache.current  — used for all new encryptions and first-attempt decryption
 * _keyCache.previous — fallback for decryption only (rotation support)
 * _keyCache.loaded   — whether the cache has been populated
 */
let _keyCache = { current: null, previous: null, loaded: false };

function _loadKeys() {
    const current  = _normalizeKey(
        process.env.COREX_SECRETS_KEY || process.env.COREX_MASTER_KEY || ""
    );
    const previous = _normalizeKey(
        process.env.COREX_SECRETS_KEY_OLD || ""
    );

    _keyCache = { current, previous, loaded: true };
    return _keyCache;
}

function _getKeys() {
    if (!_keyCache.loaded) _loadKeys();
    return _keyCache;
}

/**
 * Force a cache reload — useful after rotating keys in env or in tests.
 */
function reloadKeys() {
    _keyCache = { current: null, previous: null, loaded: false };
    return _loadKeys();
}

/**
 * Validate key availability at startup.
 * Call this during application boot. Throws if no usable key is configured
 * so the system fails fast rather than running silently without encryption.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.requireKey=true]  — throw if no key is set
 * @param {boolean} [opts.warn=true]        — warn if only a legacy key alias is set
 */
function validateKeyConfig({ requireKey = true, warn = true } = {}) {
    const keys = _getKeys();

    if (requireKey && !keys.current) {
        throw new Error(
            "[secretsManager] No encryption key configured. " +
            "Set COREX_SECRETS_KEY to a 32-byte hex or base64 value."
        );
    }

    if (warn && !keys.current && process.env.COREX_MASTER_KEY) {
        // COREX_MASTER_KEY is a legacy alias — nudge towards the canonical name.
        console.warn(
            "[secretsManager] COREX_MASTER_KEY is deprecated. " +
            "Rename to COREX_SECRETS_KEY."
        );
    }

    return true;
}

// ─── Core encrypt / decrypt ───────────────────────────────────────────────────

function isEncryptedString(value) {
    return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext string.
 *
 * - Returns the plaintext unchanged if no key is configured (with a warning)
 *   so the system degrades gracefully when encryption is not set up.
 * - Returns the input unchanged if it is already encrypted.
 * - Never encrypts an empty string — logs a warning instead.
 *
 * @param   {string} plaintext
 * @returns {string} `enc:v1:<iv>:<ciphertext>:<tag>` or original plaintext
 */
function encryptString(plaintext) {
    const { current: key } = _getKeys();
    const clear = String(plaintext ?? "");

    if (!clear) {
        // Encrypting empty values creates a false sense of security.
        // Warn loudly rather than storing an encrypted empty string.
        console.warn("[secretsManager] encryptString called with empty value — skipping.");
        return clear;
    }

    if (isEncryptedString(clear)) return clear;

    if (!key) {
        console.warn(
            "[secretsManager] No key configured — storing plaintext. " +
            "Set COREX_SECRETS_KEY to enable encryption."
        );
        return clear;
    }

    const iv      = crypto.randomBytes(IV_BYTES);
    const cipher  = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(AAD, "utf8"));

    const ciphertext = Buffer.concat([cipher.update(clear, "utf8"), cipher.final()]);
    const tag        = cipher.getAuthTag();

    return `${PREFIX}${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

/**
 * Decrypt a value produced by `encryptString`.
 *
 * Key rotation: tries the current key first, then the previous key if set.
 * This allows old ciphertexts to be read while new ones use the current key.
 *
 * @param   {string} value
 * @returns {string} plaintext
 * @throws  {DecryptionError} if the value looks encrypted but cannot be decrypted
 */
function decryptString(value) {
    const raw = String(value ?? "");

    if (!isEncryptedString(raw)) return raw;   // plaintext passthrough

    const { current, previous } = _getKeys();

    if (!current && !previous) {
        throw new DecryptionError(
            "Cannot decrypt: no key is configured. Set COREX_SECRETS_KEY."
        );
    }

    const parts = raw.slice(PREFIX.length).split(":");
    if (parts.length !== 3) {
        throw new DecryptionError(
            `Malformed encrypted value: expected 3 parts after prefix, got ${parts.length}.`
        );
    }

    const [ivB64, ctB64, tagB64] = parts;

    // Validate base64 segments are non-empty before attempting decode.
    if (!ivB64 || !ctB64 || !tagB64) {
        throw new DecryptionError("Malformed encrypted value: one or more segments are empty.");
    }

    // Try current key, then previous (rotation fallback).
    const keysToTry = [current, previous].filter(Boolean);
    let lastErr;

    for (const key of keysToTry) {
        try {
            const iv         = Buffer.from(ivB64,  "base64");
            const ciphertext = Buffer.from(ctB64,  "base64");
            const tag        = Buffer.from(tagB64, "base64");

            if (iv.length !== IV_BYTES) {
                throw new Error(`IV length ${iv.length} !== expected ${IV_BYTES}`);
            }
            if (tag.length !== TAG_BYTES) {
                throw new Error(`Tag length ${tag.length} !== expected ${TAG_BYTES}`);
            }

            const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAAD(Buffer.from(AAD, "utf8"));
            decipher.setAuthTag(tag);

            const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return clear.toString("utf8");
        } catch (e) {
            lastErr = e;
            // Try next key.
        }
    }

    // All keys failed — throw a typed error. Never return the raw ciphertext.
    throw new DecryptionError(
        "Decryption failed: authentication tag mismatch or corrupt ciphertext. " +
        "Check that COREX_SECRETS_KEY matches the key used to encrypt this value.",
        lastErr
    );
}

// ─── Object helpers ───────────────────────────────────────────────────────────

function _getAtPath(obj, dotPath) {
    const parts = String(dotPath || "").split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = cur[p];
    }
    return cur;
}

function _setAtPath(obj, dotPath, value) {
    const parts = String(dotPath || "").split(".").filter(Boolean);
    if (!parts.length) return false;
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
        cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
    return true;
}

const DEFAULT_SECRET_PATHS = [
    "ui.integrations.marketData.twelveDataApiKey",
    "ui.integrations.metaApi.token",
    "ui.integrations.mt5Bridge.bridgeToken",
    "ui.integrations.mt5Bridge.httpToken",
    "ui.integrations.mt5Bridge.http_token"
];

/**
 * Encrypt all secret fields in an object.
 * Operates on a shallow clone of the top-level object to avoid mutating the
 * caller's reference. Nested objects are still mutated — use structuredClone
 * if you need full isolation.
 *
 * @param   {object}   obj
 * @param   {string[]} [secretPaths]
 * @returns {object}   the (cloned) object with secrets encrypted
 */
function encryptObjectSecrets(obj, secretPaths = DEFAULT_SECRET_PATHS) {
    if (!obj || typeof obj !== "object") return obj;
    const result = { ...obj };   // shallow clone — callers' top-level reference is safe
    for (const p of secretPaths || []) {
        const v = _getAtPath(result, p);
        if (typeof v !== "string") continue;
        _setAtPath(result, p, encryptString(v));
    }
    return result;
}

/**
 * Decrypt all secret fields in an object.
 * Operates on a shallow clone of the top-level object.
 *
 * @param   {object}   obj
 * @param   {string[]} [secretPaths]
 * @returns {object}   the (cloned) object with secrets decrypted
 * @throws  {DecryptionError} if any field fails decryption
 */
function decryptObjectSecrets(obj, secretPaths = DEFAULT_SECRET_PATHS) {
    if (!obj || typeof obj !== "object") return obj;
    const result = { ...obj };
    for (const p of secretPaths || []) {
        const v = _getAtPath(result, p);
        if (typeof v !== "string") continue;
        // Let DecryptionError propagate — callers must not silently swallow it.
        _setAtPath(result, p, decryptString(v));
    }
    return result;
}

/**
 * Return a deep clone of `obj` with all secret fields replaced by "<redacted>".
 *
 * IMPORTANT: always deep-clones before masking so the live config object
 * is never modified. Safe to pass directly to loggers.
 *
 * @param   {object}   obj
 * @param   {string[]} [secretPaths]
 * @returns {object}   a new object safe for logging
 */
function maskSecrets(obj, secretPaths = DEFAULT_SECRET_PATHS) {
    if (!obj || typeof obj !== "object") return obj;

    // Deep clone — never touch the caller's live object.
    const cloned = JSON.parse(JSON.stringify(obj));

    for (const p of secretPaths || []) {
        const v = _getAtPath(cloned, p);
        if (typeof v !== "string" || !v) continue;
        _setAtPath(cloned, p, "<redacted>");
    }
    return cloned;
}

/**
 * Re-encrypt all secret fields using the current key.
 * Reads existing values with the current+previous keys (rotation fallback),
 * then writes them back encrypted with the current key only.
 *
 * Use this after rotating COREX_SECRETS_KEY to migrate old ciphertexts.
 *
 * @param   {object}   obj
 * @param   {string[]} [secretPaths]
 * @returns {object}   new object with all secrets re-encrypted under current key
 * @throws  {DecryptionError} if any field cannot be decrypted (bad key)
 */
function rotateObjectSecrets(obj, secretPaths = DEFAULT_SECRET_PATHS) {
    if (!obj || typeof obj !== "object") return obj;
    // Decrypt with current+previous keys, then re-encrypt with current key only.
    const decrypted = decryptObjectSecrets(obj, secretPaths);
    // Temporarily force re-encryption by clearing the enc prefix so encryptString
    // doesn't short-circuit on already-encrypted values.
    const result = { ...decrypted };
    for (const p of secretPaths || []) {
        const v = _getAtPath(result, p);
        if (typeof v !== "string" || !v) continue;
        // v is now plaintext (post-decrypt). Encrypt under current key.
        _setAtPath(result, p, encryptString(v));
    }
    return result;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    // Constants
    PREFIX,
    DEFAULT_SECRET_PATHS,

    // Errors
    DecryptionError,

    // Key management
    reloadKeys,
    validateKeyConfig,

    // Core
    isEncryptedString,
    encryptString,
    decryptString,

    // Object helpers
    encryptObjectSecrets,
    decryptObjectSecrets,
    maskSecrets,
    rotateObjectSecrets
};