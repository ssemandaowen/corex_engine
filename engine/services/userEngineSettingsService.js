"use strict";

const db = require("@core/services/postgres");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("USER_ENGINE_SETTINGS");

class UserEngineSettingsService {
    async get(userId) {
        if (!userId) throw new Error("userId is required");

        const { rows } = await db.query(
            `SELECT *
             FROM user_engine_settings
             WHERE user_id = $1
             LIMIT 1`,
            [userId]
        );

        if (!rows?.[0]) {
            return this._defaults();
        }

        return this._fromRow(rows[0]);
    }

    async update(userId, patch = {}) {
        if (!userId) throw new Error("userId is required");

        const current = await this.get(userId);
        const merged = this._merge(current, patch);

        const result = await db.query(
            `INSERT INTO user_engine_settings
                 (user_id, max_concurrent_strategies, default_paper_balance, default_timeframe,
                  default_mode, risk_max_daily_loss_pct, risk_max_position_pct,
                  notifications_json, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET max_concurrent_strategies = EXCLUDED.max_concurrent_strategies,
                 default_paper_balance     = EXCLUDED.default_paper_balance,
                 default_timeframe         = EXCLUDED.default_timeframe,
                 default_mode              = EXCLUDED.default_mode,
                 risk_max_daily_loss_pct   = EXCLUDED.risk_max_daily_loss_pct,
                 risk_max_position_pct     = EXCLUDED.risk_max_position_pct,
                 notifications_json        = EXCLUDED.notifications_json,
                 updated_at                = NOW()
             RETURNING *`,
            [
                userId,
                merged.maxConcurrentStrategies,
                merged.defaultPaperBalance,
                merged.defaultTimeframe,
                merged.defaultMode,
                merged.riskMaxDailyLossPct,
                merged.riskMaxPositionPct,
                JSON.stringify(merged.notifications || {})
            ]
        );

        return this._fromRow(result.rows?.[0] || { user_id: userId, ...merged });
    }

    _defaults() {
        return {
            userId: null,
            maxConcurrentStrategies: 3,
            defaultPaperBalance: 100000,
            defaultTimeframe: "1m",
            defaultMode: "PAPER",
            riskMaxDailyLossPct: null,
            riskMaxPositionPct: null,
            notifications: {}
        };
    }

    _fromRow(row = {}) {
        return {
            userId: row.user_id || null,
            maxConcurrentStrategies: Number(row.max_concurrent_strategies ?? 3),
            defaultPaperBalance: Number(row.default_paper_balance ?? 100000),
            defaultTimeframe: String(row.default_timeframe || "1m"),
            defaultMode: String(row.default_mode || "PAPER").toUpperCase(),
            riskMaxDailyLossPct: row.risk_max_daily_loss_pct !== null ? Number(row.risk_max_daily_loss_pct) : null,
            riskMaxPositionPct: row.risk_max_position_pct !== null ? Number(row.risk_max_position_pct) : null,
            notifications: (row.notifications_json && typeof row.notifications_json === "object")
                ? row.notifications_json
                : {}
        };
    }

    _merge(current = {}, patch = {}) {
        const out = { ...current };
        const map = {
            maxConcurrentStrategies: "maxConcurrentStrategies",
            defaultPaperBalance: "defaultPaperBalance",
            defaultTimeframe: "defaultTimeframe",
            defaultMode: "defaultMode",
            riskMaxDailyLossPct: "riskMaxDailyLossPct",
            riskMaxPositionPct: "riskMaxPositionPct",
            notifications: "notifications"
        };
        for (const [camel, snake] of Object.entries(map)) {
            if (patch[camel] !== undefined) out[snake] = patch[camel];
        }
        return out;
    }
}

module.exports = new UserEngineSettingsService();
