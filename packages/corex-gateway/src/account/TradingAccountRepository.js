"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const { Pool } = require("pg");
const { Account } = require("./Account");
const { generateAccountId } = require("./AccountId");

const DEFAULT_LIMITS = { ...Account.DEFAULT_LIMITS };

class TradingAccountRepository {
    constructor({ pool, limits = {} } = {}) {
        this._pool = pool || _createPool();
        this._limits = { ...DEFAULT_LIMITS, ...limits };
    }

    async create({ userId, type, label, brokerBinding = null }) {
        const validationErrors = Account.validate({ userId, type, label, brokerBinding });
        if (validationErrors.length > 0) {
            return { ok: false, error: validationErrors[0], reasonCode: "VALIDATION_ERROR" };
        }

        const limit = type === "live" ? this._limits.live : this._limits.paper;
        const count = await this._countByUserAndType(userId, type);
        if (count >= limit) {
            return {
                ok: false,
                error: `Account limit reached: max ${limit} ${type} accounts per user`,
                reasonCode: "ACCOUNT_LIMIT_EXCEEDED",
            };
        }

        const isDefault = (await this._countByUserAndType(userId, type)) === 0;
        const accountId = generateAccountId(type);
        const status = "active";

        const sql = `
            INSERT INTO trading_accounts (account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at
        `;
        const brokerBindingJson = brokerBinding ? JSON.stringify(brokerBinding) : null;
        const { rows } = await this._pool.query(sql, [accountId, userId, type, label || null, brokerBindingJson, isDefault, status]);

        return { ok: true, account: _rowToAccount(rows[0]) };
    }

    async listByUser(userId) {
        const sql = `
            SELECT account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at
            FROM trading_accounts
            WHERE user_id = $1
            ORDER BY created_at DESC
        `;
        const { rows } = await this._pool.query(sql, userId);
        return rows.map(_rowToAccount);
    }

    async getByAccountId(accountId) {
        const sql = `
            SELECT account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at
            FROM trading_accounts
            WHERE account_id = $1
        `;
        const { rows } = await this._pool.query(sql, [accountId]);
        if (rows.length === 0) return null;
        return _rowToAccount(rows[0]);
    }

    async getDefaultForUser(userId, accountType) {
        if (!accountType || !["paper", "live"].includes(accountType)) {
            throw new Error("accountType is required and must be one of: paper, live");
        }
        const sql = `
            SELECT account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at
            FROM trading_accounts
            WHERE user_id = $1 AND type = $2 AND is_default = true
            LIMIT 1
        `;
        const { rows } = await this._pool.query(sql, [userId, accountType]);
        if (rows.length === 0) return null;
        return _rowToAccount(rows[0]);
    }

    async setDefault(userId, accountId) {
        const target = await this.getByAccountId(accountId);
        if (!target || target.userId !== userId) {
            return { ok: false, error: "Account not found", reasonCode: "NOT_FOUND" };
        }

        await this._pool.query(
            `UPDATE trading_accounts SET is_default = false, updated_at = NOW() WHERE user_id = $1 AND type = $2`,
            [userId, target.type]
        );
        const { rows } = await this._pool.query(
            `UPDATE trading_accounts SET is_default = true, updated_at = NOW() WHERE account_id = $1
             RETURNING account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at`,
            [accountId]
        );
        return { ok: true, account: _rowToAccount(rows[0]) };
    }

    async archive(accountId) {
        const sql = `
            UPDATE trading_accounts
            SET status = 'archived', updated_at = NOW()
            WHERE account_id = $1
            RETURNING account_id, user_id, type, label, broker_binding, is_default, status, created_at, updated_at
        `;
        const { rows } = await this._pool.query(sql, [accountId]);
        if (rows.length === 0) return { ok: false, error: "Account not found", reasonCode: "NOT_FOUND" };
        return { ok: true, account: _rowToAccount(rows[0]) };
    }

    async countByType(userId, type) {
        return this._countByUserAndType(userId, type);
    }

    async _countByUserAndType(userId, type) {
        const sql = `SELECT COUNT(*)::int AS n FROM trading_accounts WHERE user_id = $1 AND type = $2 AND status = 'active'`;
        const { rows } = await this._pool.query(sql, [userId, type]);
        return rows[0]?.n || 0;
    }

    async close() {
        if (this._pool) await this._pool.end();
    }
}

function _rowToAccount(row) {
    return new Account({
        accountId: row.account_id,
        userId: row.user_id,
        type: row.type,
        label: row.label,
        brokerBinding: row.broker_binding || null,
        isDefault: row.is_default,
        status: row.status,
    });
}

function _createPool() {
    return new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        max: 5,
    });
}

module.exports = { TradingAccountRepository };
