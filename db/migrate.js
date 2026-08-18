"use strict";

require("module-alias/register");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const db = require("@core/services/postgres");
const { hashPassword } = require("@core/services/authService");
const logger = require("@utils/logger");

const ROOT = process.cwd();
const MIGRATION_DIR = path.join(ROOT, "db", "migrations");
const LEGACY_DB_PATH = path.join(ROOT, "data", "db", "corex_db.json");
const LEGACY_SETTINGS_DIR = path.join(ROOT, "data", "settings");
const LEGACY_SYSTEM_SETTINGS = path.join(LEGACY_SETTINGS_DIR, "system_settings.json");
const LEGACY_PAPER_SETTINGS = path.join(LEGACY_SETTINGS_DIR, "paper_settings.json");
const LEGACY_LIVE_SETTINGS = path.join(LEGACY_SETTINGS_DIR, "live_settings.json");
const LEGACY_UPLOADS_INDEX = path.join(ROOT, "data", "uploads", "index.json");
const newId = () => crypto.randomUUID();

function envTrue(v) {
    return ["1", "true", "yes", "on"].includes(String(v || "").trim().toLowerCase());
}

function isDbRequired() {
    if (process.env.COREX_DB_REQUIRED != null) {
        return envTrue(process.env.COREX_DB_REQUIRED);
    }
    return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function isDbConnectionError(err) {
    if (!err) return false;
    const directCode = String(err.code || "");
    if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(directCode)) return true;
    const nested = Array.isArray(err.errors) ? err.errors : [];
    return nested.some((e) => ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(String(e?.code || "")));
}

// ── DB connection wait state ────────────────────────────────────────────────
// Exposed so a health route / WS status can reflect "waiting for DB" instead
// of just looking dead or half-broken while this loop runs.
let _dbWaitState = { waiting: false, attempt: 0, startedAt: null };
function getDbWaitState() {
    return { ..._dbWaitState };
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Ping-pong wait loop for an offline-but-configured database.
 *
 * Instead of either crashing immediately (COREX_DB_REQUIRED=true) or
 * silently booting half-broken (COREX_DB_REQUIRED=false), this retries the
 * connection on an interval, shows a live spinner with attempt/elapsed time,
 * and gives the operator two explicit options:
 *   - do nothing: keep waiting, retries automatically once DB comes online
 *   - press 'q' or Ctrl+C: cancel the wait and fall through (degraded mode
 *     if COREX_DB_REQUIRED=false, otherwise bootstrap() aborts cleanly)
 *
 * In a non-TTY environment (Docker/CI, no human to press a key) the loop is
 * bounded by COREX_DB_WAIT_MAX_ATTEMPTS instead of waiting forever.
 */
async function waitForDbConnection({
    intervalMs = Number(process.env.COREX_DB_WAIT_INTERVAL_MS || 3000),
    maxAttempts = process.stdin.isTTY ? Infinity : Number(process.env.COREX_DB_WAIT_MAX_ATTEMPTS || 10)
} = {}) {
    // isTTY is false when spawned via execSync/child_process from menu.js.
    // We still want Ctrl+C to work — wire it through SIGINT in all cases.
    const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let attempt = 0;
    let cancelled = false;
    let onKeypress = null;
    let onSigint = null;
    let wasRaw = false;

    // ── SIGINT handler (works in both TTY and non-TTY) ────────────────────
    // This fires when the user presses Ctrl+C in any shell context,
    // including when db:migrate is launched from menu.js via execSync.
    onSigint = () => { cancelled = true; };
    process.once("SIGINT", onSigint);

    if (isTty) {
        try {
            readline.emitKeypressEvents(process.stdin);
            wasRaw = process.stdin.isRaw;
            if (!wasRaw) process.stdin.setRawMode(true);
            process.stdin.resume();
            onKeypress = (str, key = {}) => {
                if ((key && key.ctrl && key.name === "c") || key?.name === "q") {
                    cancelled = true;
                }
            };
            process.stdin.on("keypress", onKeypress);
        } catch (_) {
            // setRawMode throws in some CI / pipe contexts — silently fall back
        }
    }

    const clearLine = () => {
        if (!isTty) return;
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(" ".repeat(110));
        readline.cursorTo(process.stdout, 0);
    };

    _dbWaitState = { waiting: true, attempt: 0, startedAt: Date.now() };
    if (!isTty) {
        logger.warn(`[DB] Database unreachable — retrying every ${Math.round(intervalMs / 1000)}s (no TTY: bounded to ${maxAttempts} attempts).`);
    }

    try {
        let frame = 0;
        while (attempt < maxAttempts) {
            attempt += 1;
            _dbWaitState.attempt = attempt;

            try {
                await db.getPool().query("SELECT 1");
                clearLine();
                logger.info(`[DB] Connection established after ${attempt} attempt(s).`);
                return { ok: true, attempt };
            } catch (err) {
                if (!isDbConnectionError(err)) throw err; // a real query error, not connectivity — don't mask it
            }

            const elapsedSec = Math.round((Date.now() - _dbWaitState.startedAt) / 1000);
            for (let waited = 0; waited < intervalMs; waited += 200) {
                if (cancelled) break;
                if (isTty) {
                    frame += 1;
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(
                        `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} Waiting for DB connection... ` +
                        `(attempt ${attempt}, ${elapsedSec}s elapsed) — press 'q' or Ctrl+C to continue without DB`
                    );
                }
                await new Promise((resolve) => setTimeout(resolve, 200));
            }

            if (cancelled) {
                clearLine();
                logger.warn(`[DB] Connection wait cancelled by operator after ${attempt} attempt(s).`);
                return { ok: false, cancelled: true, attempt };
            }
        }

        clearLine();
        logger.warn(`[DB] Gave up after ${attempt} attempt(s) (no TTY present to confirm — set COREX_DB_WAIT_MAX_ATTEMPTS to change).`);
        return { ok: false, cancelled: false, attempt };
    } finally {
        _dbWaitState.waiting = false;
        if (onSigint) process.removeListener("SIGINT", onSigint);
        if (onKeypress) {
            process.stdin.removeListener("keypress", onKeypress);
            // Restore raw mode state if we changed it
            if (isTty && !wasRaw) {
                try { process.stdin.setRawMode(false); } catch (_) {}
            }
        }
    }
}

async function applyMigrations() {
    await db.query(
        `CREATE TABLE IF NOT EXISTS public.schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
    );
    const files = fs.readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
        const version = file.replace(/\.sql$/i, "");
        const exists = await db.query("SELECT 1 FROM public.schema_migrations WHERE version = $1", [version]);
        if (exists.rowCount > 0) continue;

        const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf8");
        await db.withTransaction(async (tx) => {
            await tx.query(sql);
            await tx.query("INSERT INTO public.schema_migrations (version) VALUES ($1)", [version]);
        });
        logger.info(`[DB] Applied migration: ${version}`);
    }
}

function readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

async function migrateLegacyUsersAndAccounts() {
    const legacy = readJson(LEGACY_DB_PATH);
    if (!legacy || typeof legacy !== "object") return;

    const users = Array.isArray(legacy.users) ? legacy.users : [];
    const accounts = Array.isArray(legacy.accounts) ? legacy.accounts : [];
    const quotas = Array.isArray(legacy.quota) ? legacy.quota : [];
    const fallbackPassword = process.env.AUTH_MIGRATED_DEFAULT_PASSWORD || "ChangeMe123!";
    const fallbackHash = await hashPassword(fallbackPassword);

    await db.withTransaction(async (tx) => {
        for (const u of users) {
            const id = u.id || newId();
            const email = String(u.email || "").trim().toLowerCase();
            if (!email) continue;
            const name = String(u.name || email.split("@")[0] || "User");
            const status = String(u.status || "active");

            await tx.query(
                `INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()),COALESCE($8::timestamptz, NOW()))
                 ON CONFLICT (email) DO NOTHING`,
                [
                    id,
                    email,
                    name,
                    "user",
                    status,
                    fallbackHash,
                    u.createdAt || null,
                    u.updatedAt || null
                ]
            );
        }

        for (const a of accounts) {
            if (!a.userId || !a.id) continue;
            await tx.query(
                `INSERT INTO user_accounts (id, user_id, mode, broker, account_ref, status, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()),COALESCE($8::timestamptz, NOW()))
                 ON CONFLICT (id) DO NOTHING`,
                [
                    a.id,
                    a.userId,
                    String(a.mode || "live"),
                    String(a.broker || "mt5"),
                    a.accountRef || null,
                    String(a.status || "active"),
                    a.createdAt || null,
                    a.updatedAt || null
                ]
            );
        }

        for (const q of quotas) {
            if (!q.userId) continue;
            await tx.query(
                `INSERT INTO quota_profiles (id, user_id, plan, signals_per_day, signals_used_today, reset_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, NOW()),COALESCE($7::timestamptz, NOW()))
                 ON CONFLICT (user_id) DO UPDATE
                 SET plan = EXCLUDED.plan,
                     signals_per_day = EXCLUDED.signals_per_day,
                     signals_used_today = EXCLUDED.signals_used_today,
                     reset_at = EXCLUDED.reset_at,
                     updated_at = EXCLUDED.updated_at`,
                [
                    q.id || newId(),
                    q.userId,
                    q.plan || "starter",
                    Number(q.signalsPerDay ?? 100),
                    Number(q.signalsUsedToday ?? 0),
                    q.resetAt || null,
                    q.updatedAt || null
                ]
            );
        }
    });

    logger.info(`[DB] Migrated legacy users/accounts/quota from ${LEGACY_DB_PATH}`);
}

async function migrateLegacySettings() {
    const systemSettings = readJson(LEGACY_SYSTEM_SETTINGS);
    if (systemSettings && typeof systemSettings === "object") {
        await db.query(
            `INSERT INTO system_settings (id, payload, updated_at)
             VALUES (1, $1::jsonb, NOW())
             ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
            [JSON.stringify(systemSettings)]
        );
    }

    const applyBroker = async (mode, legacyFile) => {
        const payload = readJson(legacyFile);
        if (!payload || typeof payload !== "object") return;
        await db.query(
            `INSERT INTO broker_settings (mode, cash, initial_cash, config, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, NOW())
             ON CONFLICT (mode) DO UPDATE
             SET cash = EXCLUDED.cash,
                 initial_cash = EXCLUDED.initial_cash,
                 config = EXCLUDED.config,
                 updated_at = EXCLUDED.updated_at`,
            [
                mode,
                Number(payload.cash ?? 0),
                Number(payload.initialCash ?? payload.cash ?? 0),
                JSON.stringify(payload.config || {})
            ]
        );
    };

    await applyBroker("paper", LEGACY_PAPER_SETTINGS);
    await applyBroker("live", LEGACY_LIVE_SETTINGS);
}

async function migrateLegacyBacktestUploads() {
    const raw = readJson(LEGACY_UPLOADS_INDEX);
    const items = Array.isArray(raw) ? raw : [];
    if (!items.length) return;

    await db.withTransaction(async (tx) => {
        for (const item of items) {
            const id = String(item?.id || "").trim();
            const userId = String(item?.userId || "").trim();
            const digest = String(item?.digest || "").trim();
            if (!id || !userId || !digest) continue;

            const symbol = String(item?.symbol || "UNASSIGNED").trim().toUpperCase();
            const source = String(item?.source || "legacy").trim().toLowerCase() || "legacy";
            const originalName = String(item?.originalname || item?.originalName || "").trim() || null;
            const ext = String(item?.ext || "").trim() || null;
            const dedupPath = item?.dedupPath ? String(item.dedupPath) : null;
            const symbolPath = item?.symbolPath ? String(item.symbolPath) : null;
            const sizeBytes = Number(item?.size || 0);
            const createdAt = Number(item?.createdAt || Date.now());

            await tx.query(
                `INSERT INTO backtest_uploads
                    (id, user_id, digest, symbol, source, original_name, ext, dedup_path, symbol_path, size_bytes, created_at, updated_at, last_used_at)
                 VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0), NOW(), NOW())
                 ON CONFLICT (id) DO UPDATE
                 SET digest = EXCLUDED.digest,
                     symbol = EXCLUDED.symbol,
                     source = EXCLUDED.source,
                     original_name = EXCLUDED.original_name,
                     ext = EXCLUDED.ext,
                     dedup_path = EXCLUDED.dedup_path,
                     symbol_path = EXCLUDED.symbol_path,
                     size_bytes = EXCLUDED.size_bytes,
                     updated_at = NOW(),
                     last_used_at = NOW()`,
                [
                    id,
                    userId,
                    digest,
                    symbol,
                    source,
                    originalName,
                    ext,
                    dedupPath,
                    symbolPath,
                    Number.isFinite(sizeBytes) ? Math.max(0, Math.floor(sizeBytes)) : 0,
                    Number.isFinite(createdAt) ? createdAt : Date.now()
                ]
            );
        }
    });

    logger.info(`[DB] Migrated legacy uploads index from ${LEGACY_UPLOADS_INDEX}`);
}

async function seedDefaultAdminIfEmpty() {
    const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM users");
    if ((rows[0]?.n || 0) > 0) return;

    const email = String(process.env.AUTH_ADMIN_EMAIL || "admin@corex.local").toLowerCase();
    const name = String(process.env.AUTH_ADMIN_NAME || "CoreX Admin");
    const password = process.env.AUTH_ADMIN_PASSWORD || "ChangeMe123!";
    const passwordHash = await hashPassword(password);
    const id = newId();

    await db.withTransaction(async (tx) => {
        await tx.query(
            `INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at)
             VALUES ($1,$2,$3,'admin','active',$4,NOW(),NOW())`,
            [id, email, name, passwordHash]
        );
        await tx.query(
            `INSERT INTO quota_profiles (id, user_id, plan, signals_per_day, signals_used_today, reset_at, updated_at)
             VALUES ($1,$2,'pro',100000,0,NOW(),NOW())`,
            [newId(), id]
        );
    });

    logger.warn(`[DB] Seeded default admin: ${email} (change AUTH_ADMIN_PASSWORD immediately)`);
}

async function run() {
    const dbRequired = isDbRequired();

    if (!db.hasDbConfig()) {
        if (dbRequired) {
            throw new Error("POSTGRES_NOT_CONFIGURED: set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE");
        }
        logger.warn("[DB] Postgres not configured. Skipping migrations (COREX_DB_REQUIRED=false).");
        return { skipped: true, reason: "NOT_CONFIGURED" };
    }

    // DB is configured (the operator intends to use it) but may not be
    // reachable yet — wait/retry instead of failing on the first hiccup.
    let reachable = false;
    try {
        await db.getPool().query("SELECT 1");
        reachable = true;
    } catch (err) {
        if (!isDbConnectionError(err)) throw err;
    }

    if (!reachable) {
        const waited = await waitForDbConnection();
        if (!waited.ok) {
            if (dbRequired) {
                throw new Error(`POSTGRES_UNREACHABLE: ${waited.cancelled ? "connection wait cancelled by operator" : "gave up after " + waited.attempt + " attempt(s)"} and COREX_DB_REQUIRED=true`);
            }
            logger.warn("[DB] Continuing without a database connection (degraded mode — DB-backed routes will fail until it's reachable).");
            return { skipped: true, reason: waited.cancelled ? "CANCELLED_BY_OPERATOR" : "WAIT_EXHAUSTED" };
        }
    }

    try {
        await applyMigrations();
        await migrateLegacyUsersAndAccounts();
        await migrateLegacySettings();
        await migrateLegacyBacktestUploads();
        await seedDefaultAdminIfEmpty();
        return { skipped: false };
    } catch (err) {
        if (!dbRequired && isDbConnectionError(err)) {
            logger.warn(`[DB] Postgres unreachable (${err.code || "CONNECTION_ERROR"}). Skipping migrations (COREX_DB_REQUIRED=false).`);
            return { skipped: true, reason: "UNREACHABLE", error: err.message };
        }
        throw err;
    }
}

if (require.main === module) {
    run()
        .then(async () => {
            logger.info("[DB] Migration complete.");
            await db.close();
            process.exit(0);
        })
        .catch(async (err) => {
            logger.error(`[DB] Migration failed: ${err.message}`);
            await db.close();
            process.exit(1);
        });
}

module.exports = {
    run,
    getDbWaitState
};