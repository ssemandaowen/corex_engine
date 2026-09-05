"use strict";

const crypto = require("crypto");
const db = require("@core/services/postgres");
const { sanitizeUserId } = require("@core/services/userScope");
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

const toBacktestUploadPayload = (row) => ({
    id: row.id,
    userId: row.user_id,
    digest: row.digest,
    symbol: row.symbol,
    source: row.source,
    originalname: row.original_name,
    ext: row.ext,
    dedupPath: row.dedup_path,
    symbolPath: row.symbol_path,
    size: Number(row.size_bytes || 0),
    barsCount: row.bars_count == null ? null : Number(row.bars_count),
    meta: row.meta || {},
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : null
});

const toBacktestDatasetPayload = (row) => ({
    id: row.id,
    cacheKey: row.cache_key,
    userId: row.user_id || null,
    source: row.source,
    symbol: row.symbol,
    timeframe: row.timeframe,
    outputsize: Number(row.outputsize || 0),
    rangeMode: row.range_mode,
    rangeStart: row.range_start == null ? null : Number(row.range_start),
    rangeEnd: row.range_end == null ? null : Number(row.range_end),
    barsCount: Number(row.bars_count || 0),
    bars: Array.isArray(row.bars) ? row.bars : [],
    meta: row.meta || {},
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : null
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

    async getSystemSettingsForUser(userId) {
        const uid = sanitizeUserId(userId);
        if (!uid) return this.getSystemSettings();

        const { rows } = await db.query(
            "SELECT payload, updated_at FROM user_system_settings WHERE user_id = $1 LIMIT 1",
            [uid]
        );
        if (!rows[0]) return this.getSystemSettings();
        return {
            userId: uid,
            payload: rows[0].payload || {},
            updatedAt: rows[0].updated_at
        };
    }

    async upsertSystemSettingsForUser(userId, payload = {}) {
        const uid = sanitizeUserId(userId);
        if (!uid) throw new Error("USER_ID_REQUIRED");
        const { rows } = await db.query(
            `INSERT INTO user_system_settings (user_id, payload, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
             RETURNING user_id, payload, updated_at`,
            [uid, JSON.stringify(payload)]
        );
        return {
            userId: rows[0].user_id,
            payload: rows[0].payload || {},
            updatedAt: rows[0].updated_at
        };
    }

    async getBrokerSettingsForUser(userId, mode) {
        const uid = sanitizeUserId(userId);
        const m = String(mode || "").toLowerCase();
        if (!uid) return this.getBrokerSettings(m);
        if (!m) return null;
        const { rows } = await db.query(
            "SELECT * FROM user_broker_settings WHERE user_id = $1 AND mode = $2 LIMIT 1",
            [uid, m]
        );
        if (!rows[0]) return this.getBrokerSettings(m);
        return {
            userId: rows[0].user_id,
            mode: rows[0].mode,
            cash: Number(rows[0].cash),
            initialCash: Number(rows[0].initial_cash),
            config: rows[0].config || {},
            updatedAt: rows[0].updated_at
        };
    }

    async upsertBrokerSettingsForUser(userId, mode, payload = {}) {
        const uid = sanitizeUserId(userId);
        const m = String(mode || "").toLowerCase();
        if (!uid) throw new Error("USER_ID_REQUIRED");
        if (!m) throw new Error("MODE_REQUIRED");

        const cash = Number(payload.cash ?? 0);
        const initialCash = Number(payload.initialCash ?? 0);
        const config = payload.config && typeof payload.config === "object" ? payload.config : {};

        const { rows } = await db.query(
            `INSERT INTO user_broker_settings (user_id, mode, cash, initial_cash, config, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
             ON CONFLICT (user_id, mode) DO UPDATE
             SET cash = EXCLUDED.cash,
                 initial_cash = EXCLUDED.initial_cash,
                 config = EXCLUDED.config,
                 updated_at = EXCLUDED.updated_at
             RETURNING *`,
            [uid, m, cash, initialCash, JSON.stringify(config)]
        );
        return {
            userId: rows[0].user_id,
            mode: rows[0].mode,
            cash: Number(rows[0].cash),
            initialCash: Number(rows[0].initial_cash),
            config: rows[0].config || {},
            updatedAt: rows[0].updated_at
        };
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

    async getStrategyByName(name) {
        const key = String(name || "").trim();
        if (!key) return null;
        const { rows } = await db.query(
            `SELECT name, script_body, updated_at, runtime_mode, runtime_params, runtime_state, runtime_updated_at
             FROM strategies
             WHERE name = $1
             LIMIT 1`,
            [key]
        );
        return rows[0] || null;
    }

    /**
     * Returns this user's current upload count and total size (bytes),
     * for quota enforcement. Excludes soft-deleted rows.
     */
    async getBacktestUploadUsageForUser(userId) {
        const uid = sanitizeUserId(userId);
        if (!uid) return { count: 0, totalBytes: 0 };
        const { rows } = await db.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
             FROM backtest_uploads
             WHERE user_id = $1
               AND (meta->>'deletedAt') IS NULL`,
            [uid]
        );
        const row = rows?.[0] || {};
        return {
            count: Number(row.count || 0),
            totalBytes: Number(row.total_bytes || 0)
        };
    }

    async listBacktestUploadsForUser(userId, { symbol = null, limit = 200 } = {}) {
        const uid = sanitizeUserId(userId);
        if (!uid) return [];
        const sym = symbol ? String(symbol).trim().toUpperCase() : null;
        const n = Math.max(1, Math.min(1000, Number(limit || 200)));
        const { rows } = await db.query(
            `SELECT *
             FROM backtest_uploads
             WHERE user_id = $1
               AND (meta->>'deletedAt') IS NULL
               ${sym ? "AND symbol = $2" : ""}
             ORDER BY created_at DESC
             LIMIT ${sym ? "$3" : "$2"}`,
            sym ? [uid, sym, n] : [uid, n]
        );
        return (rows || []).map(toBacktestUploadPayload);
    }

    async getBacktestUploadForUser(userId, uploadId) {
        const uid = sanitizeUserId(userId);
        const id = String(uploadId || "").trim();
        if (!uid || !id) return null;
        const { rows } = await db.query(
            "SELECT * FROM backtest_uploads WHERE user_id = $1 AND id = $2 AND (meta->>'deletedAt') IS NULL LIMIT 1",
            [uid, id]
        );
        return rows[0] ? toBacktestUploadPayload(rows[0]) : null;
    }

    async upsertBacktestUpload(meta = {}) {
        const id = String(meta.id || "").trim();
        const uid = sanitizeUserId(meta.userId);
        if (!id) throw new Error("UPLOAD_ID_REQUIRED");
        if (!uid) throw new Error("USER_ID_REQUIRED");
        const digest = String(meta.digest || "").trim();
        if (!digest) throw new Error("UPLOAD_DIGEST_REQUIRED");

        const symbol = String(meta.symbol || "UNASSIGNED").trim().toUpperCase();
        const source = String(meta.source || "manual").trim().toLowerCase();
        const originalName = String(meta.originalname || meta.originalName || "").trim() || null;
        const ext = String(meta.ext || "").trim() || null;
        const dedupPath = meta.dedupPath ?? meta.dedup_path ?? meta.dedupPath ?? null;
        const symbolPath = meta.symbolPath ?? meta.symbol_path ?? null;
        const sizeBytes = Number(meta.size ?? meta.sizeBytes ?? 0);
        const barsCount = Number.isFinite(Number(meta.barsCount)) ? Number(meta.barsCount) : null;
        const payloadMeta = meta.meta && typeof meta.meta === "object" ? meta.meta : {};
        const createdAt = Number(meta.createdAt || Date.now());

        const { rows } = await db.query(
            `INSERT INTO backtest_uploads
                (id, user_id, digest, symbol, source, original_name, ext, dedup_path, symbol_path, size_bytes, bars_count, meta, created_at, updated_at, last_used_at)
             VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, to_timestamp($13 / 1000.0), NOW(), NOW())
             ON CONFLICT (id) DO UPDATE
             SET digest = EXCLUDED.digest,
                 symbol = EXCLUDED.symbol,
                 source = EXCLUDED.source,
                 original_name = EXCLUDED.original_name,
                 ext = EXCLUDED.ext,
                 dedup_path = EXCLUDED.dedup_path,
                 symbol_path = EXCLUDED.symbol_path,
                 size_bytes = EXCLUDED.size_bytes,
                 bars_count = EXCLUDED.bars_count,
                 meta = EXCLUDED.meta,
                 updated_at = NOW(),
                 last_used_at = NOW()
             RETURNING *`,
            [
                id,
                uid,
                digest,
                symbol,
                source,
                originalName,
                ext,
                dedupPath,
                symbolPath,
                Number.isFinite(sizeBytes) ? Math.max(0, Math.floor(sizeBytes)) : 0,
                barsCount,
                JSON.stringify(payloadMeta),
                Number.isFinite(createdAt) ? createdAt : Date.now()
            ]
        );
        return toBacktestUploadPayload(rows[0]);
    }

    async touchBacktestUploadForUser(userId, uploadId) {
        const uid = sanitizeUserId(userId);
        const id = String(uploadId || "").trim();
        if (!uid || !id) return false;
        const { rowCount } = await db.query(
            "UPDATE backtest_uploads SET last_used_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND id = $2",
            [uid, id]
        );
        return rowCount > 0;
    }

    async listBacktestUploadsForArchive({ maxAgeDays = 60, limit = 100 } = {}) {
        const days = Math.max(1, Number(maxAgeDays || 60));
        const n = Math.max(1, Math.min(500, Number(limit || 100)));
        const { rows } = await db.query(
            `SELECT *
             FROM backtest_uploads
             WHERE COALESCE(last_used_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')
               AND (meta->>'archivedAt') IS NULL
               AND (meta->>'deletedAt') IS NULL
               AND (dedup_path IS NOT NULL OR symbol_path IS NOT NULL)
             ORDER BY COALESCE(last_used_at, created_at) ASC
             LIMIT $2`,
            [days, n]
        );
        return (rows || []).map(toBacktestUploadPayload);
    }

    async markBacktestUploadArchived({ userId, uploadId, dedupPath = null, symbolPath = null } = {}) {
        const uid = sanitizeUserId(userId);
        const id = String(uploadId || "").trim();
        if (!uid || !id) return false;
        const { rowCount } = await db.query(
            `UPDATE backtest_uploads
             SET dedup_path = $3,
                 symbol_path = $4,
                 meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{archivedAt}', to_jsonb((extract(epoch from NOW()) * 1000)::bigint), true),
                 updated_at = NOW()
             WHERE user_id = $1 AND id = $2`,
            [uid, id, dedupPath, symbolPath]
        );
        return rowCount > 0;
    }

    async listBacktestUploadsForPurge({ maxAgeDays = 180, limit = 100 } = {}) {
        const days = Math.max(1, Number(maxAgeDays || 180));
        const n = Math.max(1, Math.min(500, Number(limit || 100)));
        const { rows } = await db.query(
            `SELECT *
             FROM backtest_uploads
             WHERE COALESCE(last_used_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')
               AND (meta->>'deletedAt') IS NULL
             ORDER BY COALESCE(last_used_at, created_at) ASC
             LIMIT $2`,
            [days, n]
        );
        return (rows || []).map(toBacktestUploadPayload);
    }

    async softDeleteBacktestUploadForUser(userId, uploadId) {
        const uid = sanitizeUserId(userId);
        const id = String(uploadId || "").trim();
        if (!uid || !id) return false;
        const { rowCount } = await db.query(
            `UPDATE backtest_uploads
             SET symbol_path = NULL,
                 meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{deletedAt}', to_jsonb((extract(epoch from NOW()) * 1000)::bigint), true),
                 updated_at = NOW()
             WHERE user_id = $1 AND id = $2`,
            [uid, id]
        );
        return rowCount > 0;
    }

    async deleteBacktestUploadForUser(userId, uploadId) {
        const uid = sanitizeUserId(userId);
        const id = String(uploadId || "").trim();
        if (!uid || !id) return null;
        const { rows } = await db.query(
            "DELETE FROM backtest_uploads WHERE user_id = $1 AND id = $2 RETURNING *",
            [uid, id]
        );
        return rows[0] ? toBacktestUploadPayload(rows[0]) : null;
    }

    async upsertBacktestDataset(record = {}) {
        const cacheKey = String(record.cacheKey || "").trim();
        if (!cacheKey) throw new Error("CACHE_KEY_REQUIRED");

        const uid = sanitizeUserId(record.userId) || null;
        const id = String(record.id || newId());
        const source = String(record.source || "twelvedata").trim().toLowerCase();
        const symbol = String(record.symbol || "").trim().toUpperCase();
        const timeframe = String(record.timeframe || "1m").trim().toLowerCase();
        const outputsize = Number(record.outputsize || 0);
        const rangeMode = String(record.rangeMode || "points").trim().toLowerCase();
        const rangeStart = Number.isFinite(Number(record.rangeStart)) ? Number(record.rangeStart) : null;
        const rangeEnd = Number.isFinite(Number(record.rangeEnd)) ? Number(record.rangeEnd) : null;
        const bars = Array.isArray(record.bars) ? record.bars : [];
        const barsCount = Number.isFinite(Number(record.barsCount)) ? Number(record.barsCount) : bars.length;
        const meta = record.meta && typeof record.meta === "object" ? record.meta : {};

        if (!symbol) throw new Error("SYMBOL_REQUIRED");

        const { rows } = await db.query(
            `INSERT INTO backtest_market_data
                (id, cache_key, user_id, source, symbol, timeframe, outputsize, range_mode, range_start, range_end, bars_count, bars, meta, created_at, updated_at, last_used_at)
             VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, NOW(), NOW(), NOW())
             ON CONFLICT (cache_key) DO UPDATE
             SET user_id = EXCLUDED.user_id,
                 source = EXCLUDED.source,
                 symbol = EXCLUDED.symbol,
                 timeframe = EXCLUDED.timeframe,
                 outputsize = EXCLUDED.outputsize,
                 range_mode = EXCLUDED.range_mode,
                 range_start = EXCLUDED.range_start,
                 range_end = EXCLUDED.range_end,
                 bars_count = EXCLUDED.bars_count,
                 bars = EXCLUDED.bars,
                 meta = EXCLUDED.meta,
                 updated_at = NOW(),
                 last_used_at = NOW()
             RETURNING *`,
            [
                id,
                cacheKey,
                uid,
                source,
                symbol,
                timeframe,
                Number.isFinite(outputsize) ? Math.max(0, Math.floor(outputsize)) : 0,
                rangeMode,
                rangeStart,
                rangeEnd,
                Math.max(0, Math.floor(Number(barsCount || 0))),
                JSON.stringify(bars),
                JSON.stringify(meta)
            ]
        );
        return toBacktestDatasetPayload(rows[0]);
    }

    async deleteExpiredBacktestUploads(maxAgeDays = 30) {
        const days = Math.max(1, Number(maxAgeDays || 30));
        const { rows } = await db.query(
            `DELETE FROM backtest_uploads
             WHERE COALESCE(last_used_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')
             RETURNING *`,
            [days]
        );
        return (rows || []).map(toBacktestUploadPayload);
    }

    async deleteExpiredBacktestDatasets(maxAgeDays = 7) {
        const days = Math.max(1, Number(maxAgeDays || 7));
        const { rowCount } = await db.query(
            `DELETE FROM backtest_market_data
             WHERE COALESCE(last_used_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')`,
            [days]
        );
        return Number(rowCount || 0);
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