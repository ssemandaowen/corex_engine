"use strict";

const backtestManager = require("@core/backtestManager");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");
const log = logger.createModuleLogger("BACKTEST_SERVICE");

class BacktestService {
    async runBacktest(options) {
        log.info(`runBacktest: ${options.runtimeId}`);
        if (!options || typeof options !== "object") {
            throw new Error("VALIDATION_FAILED: Options must be an object.");
        }
        return backtestManager.runBacktest(options);
    }

    async listReports(userId) {
        if (!db.hasDbConfig()) return [];
        const { rows } = await db.query(
            "SELECT id, created_at, report FROM backtests WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );
        return (rows || []).map(r => ({
            id: r.id,
            timestamp: new Date(r.created_at).getTime(),
            size: JSON.stringify(r.report || {}).length,
            ...(r.report?.meta || {})
        }));
    }

    async getReport(reportId, userId) {
        if (!db.hasDbConfig()) return null;
        const { rows } = await db.query(
            "SELECT report FROM backtests WHERE user_id = $1 AND id = $2 LIMIT 1",
            [userId, reportId]
        );
        return rows?.[0]?.report || null;
    }

    async deleteReport(reportId, userId) {
        if (!db.hasDbConfig()) return false;
        const { rows } = await db.query(
            "DELETE FROM backtests WHERE user_id = $1 AND id = $2 RETURNING id",
            [userId, reportId]
        );
        return !!rows?.length;
    }
}

module.exports = new BacktestService();
