"use strict";

require("module-alias/register");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

    try {
        await applyMigrations();
        await migrateLegacyUsersAndAccounts();
        await migrateLegacySettings();
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
    run
};
