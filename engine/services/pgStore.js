"use strict";

const crypto = require("crypto");
const db = require("@core/services/postgres");
const newId = () => crypto.randomUUID();

const toUserPayload = (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
});

const toAccountPayload = (row) => ({
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    broker: row.broker,
    accountRef: row.account_ref,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

const toQuotaPayload = (row) => ({
    id: row.id,
    userId: row.user_id,
    plan: row.plan,
    signalsPerDay: row.signals_per_day,
    signalsUsedToday: row.signals_used_today,
    resetAt: row.reset_at,
    updatedAt: row.updated_at
});

class PgStore {
    async listUsers() {
        const { rows } = await db.query("SELECT * FROM users ORDER BY created_at DESC");
        return rows.map(toUserPayload);
    }

    async getUserById(id) {
        const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
        return rows[0] ? toUserPayload(rows[0]) : null;
    }

    async getAuthUserByEmail(email) {
        const { rows } = await db.query(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [String(email || "").trim().toLowerCase()]
        );
        return rows[0] || null;
    }

    async createUser(payload = {}) {
        const now = new Date().toISOString();
        const id = payload.id || newId();
        const email = String(payload.email || "").trim().toLowerCase();
        const name = String(payload.name || "").trim();
        const role = String(payload.role || "user").toLowerCase();
        const status = String(payload.status || "active").toLowerCase();
        const passwordHash = String(payload.passwordHash || "");

        if (!email) throw new Error("EMAIL_REQUIRED");
        if (!name) throw new Error("NAME_REQUIRED");
        if (!passwordHash) throw new Error("PASSWORD_REQUIRED");

        const created = await db.withTransaction(async (tx) => {
            const userRes = await tx.query(
                `INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
                 ON CONFLICT (email) DO NOTHING
                 RETURNING *`,
                [id, email, name, role, status, passwordHash, now]
            );
            if (!userRes.rows[0]) throw new Error("EMAIL_EXISTS");

            await tx.query(
                `INSERT INTO quota_profiles (id, user_id, plan, signals_per_day, signals_used_today, reset_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$6)
                 ON CONFLICT (user_id) DO NOTHING`,
                [newId(), id, "starter", 100, 0, now]
            );

            return userRes.rows[0];
        });

        return toUserPayload(created);
    }

    async setUserPassword(userId, passwordHash) {
        const { rowCount } = await db.query(
            "UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1",
            [userId, passwordHash]
        );
        return rowCount > 0;
    }

    async markLastLogin(userId) {
        await db.query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [userId]);
    }

    async listAccounts() {
        const { rows } = await db.query("SELECT * FROM user_accounts ORDER BY created_at DESC");
        return rows.map(toAccountPayload);
    }

    async upsertAccount(payload = {}) {
        const id = payload.id || newId();
        const userId = String(payload.userId || "").trim();
        if (!userId) throw new Error("USER_ID_REQUIRED");

        const mode = String(payload.mode || "live").toLowerCase();
        const broker = String(payload.broker || "mt5").toLowerCase();
        const accountRef = payload.accountRef != null ? String(payload.accountRef) : null;
        const status = String(payload.status || "active").toLowerCase();
        const now = new Date().toISOString();

        const sql = `
            INSERT INTO user_accounts (id, user_id, mode, broker, account_ref, status, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
            ON CONFLICT (id) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                mode = EXCLUDED.mode,
                broker = EXCLUDED.broker,
                account_ref = EXCLUDED.account_ref,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            RETURNING *
        `;
        const { rows } = await db.query(sql, [id, userId, mode, broker, accountRef, status, now]);
        return toAccountPayload(rows[0]);
    }

    async getQuota(userId) {
        const { rows } = await db.query("SELECT * FROM quota_profiles WHERE user_id = $1", [userId]);
        return rows[0] ? toQuotaPayload(rows[0]) : null;
    }

    async upsertQuota(userId, payload = {}) {
        const id = payload.id || newId();
        const plan = payload.plan != null ? String(payload.plan) : "starter";
        const signalsPerDay = payload.signalsPerDay != null ? Number(payload.signalsPerDay) : 100;
        const signalsUsedToday = payload.signalsUsedToday != null ? Number(payload.signalsUsedToday) : 0;
        const resetAt = payload.resetAt ? new Date(payload.resetAt).toISOString() : new Date().toISOString();
        const now = new Date().toISOString();

        const sql = `
            INSERT INTO quota_profiles (id, user_id, plan, signals_per_day, signals_used_today, reset_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (user_id) DO UPDATE
            SET plan = EXCLUDED.plan,
                signals_per_day = EXCLUDED.signals_per_day,
                signals_used_today = EXCLUDED.signals_used_today,
                reset_at = EXCLUDED.reset_at,
                updated_at = EXCLUDED.updated_at
            RETURNING *
        `;
        const { rows } = await db.query(sql, [id, userId, plan, signalsPerDay, signalsUsedToday, resetAt, now]);
        return toQuotaPayload(rows[0]);
    }

    async getSystemSettings() {
        const { rows } = await db.query("SELECT payload, updated_at FROM system_settings WHERE id = 1");
        if (!rows[0]) return null;
        return {
            payload: rows[0].payload || {},
            updatedAt: rows[0].updated_at
        };
    }

    async upsertSystemSettings(payload = {}) {
        const { rows } = await db.query(
            `INSERT INTO system_settings (id, payload, updated_at)
             VALUES (1, $1::jsonb, NOW())
             ON CONFLICT (id) DO UPDATE
             SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
             RETURNING payload, updated_at`,
            [JSON.stringify(payload)]
        );
        return { payload: rows[0].payload || {}, updatedAt: rows[0].updated_at };
    }

    async getBrokerSettings(mode) {
        const { rows } = await db.query("SELECT * FROM broker_settings WHERE mode = $1", [String(mode || "").toLowerCase()]);
        if (!rows[0]) return null;
        return {
            mode: rows[0].mode,
            cash: Number(rows[0].cash),
            initialCash: Number(rows[0].initial_cash),
            config: rows[0].config || {},
            updatedAt: rows[0].updated_at
        };
    }

    async upsertBrokerSettings(mode, payload = {}) {
        const m = String(mode || "").toLowerCase();
        if (!m) throw new Error("MODE_REQUIRED");
        const cash = Number(payload.cash ?? 0);
        const initialCash = Number(payload.initialCash ?? 0);
        const config = payload.config && typeof payload.config === "object" ? payload.config : {};

        const { rows } = await db.query(
            `INSERT INTO broker_settings (mode, cash, initial_cash, config, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, NOW())
             ON CONFLICT (mode) DO UPDATE
             SET cash = EXCLUDED.cash,
                 initial_cash = EXCLUDED.initial_cash,
                 config = EXCLUDED.config,
                 updated_at = EXCLUDED.updated_at
             RETURNING *`,
            [m, cash, initialCash, JSON.stringify(config)]
        );
        return {
            mode: rows[0].mode,
            cash: Number(rows[0].cash),
            initialCash: Number(rows[0].initial_cash),
            config: rows[0].config || {},
            updatedAt: rows[0].updated_at
        };
    }

    async getSummary() {
        const [{ rows: u }, { rows: a }, { rows: q }] = await Promise.all([
            db.query("SELECT COUNT(*)::int AS n FROM users"),
            db.query("SELECT COUNT(*)::int AS n FROM user_accounts"),
            db.query("SELECT COUNT(*)::int AS n FROM quota_profiles")
        ]);
        return {
            users: u[0]?.n || 0,
            accounts: a[0]?.n || 0,
            quotaProfiles: q[0]?.n || 0,
            updatedAt: new Date().toISOString()
        };
    }
}

module.exports = new PgStore();
