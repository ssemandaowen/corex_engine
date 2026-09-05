"use strict";

const { Pool } = require("pg");
const { buildClosedTrades } = require("./analytics/buildClosedTrades");
const { buildEquityAnalytics } = require("./analytics/buildEquityAnalytics");
const { buildPerformance } = require("./analytics/buildPerformance");

const toMs = (value) => {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
};

const toNum = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeEnvironment = (raw) => {
    const env = String(raw || "PAPER").trim().toUpperCase();
    if (!["PAPER", "LIVE"].includes(env)) return "PAPER";
    return env;
};

function parseFilters(raw = {}) {
    const userId = String(raw.userId || "").trim();
    const accountId = String(raw.accountId || "").trim() || null;
    const environment = normalizeEnvironment(raw.environment);
    const strategyId = String(raw.strategyId || "").trim();
    const symbol = String(raw.symbol || "").trim().toUpperCase();
    const from = raw.from ? new Date(raw.from) : null;
    const to = raw.to ? new Date(raw.to) : null;
    const limitRaw = Number(raw.limit || 2000);
    const limit = Math.max(1, Math.min(10000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 2000));

    return {
        userId: userId || null,
        accountId,
        environment,
        strategyId: strategyId || null,
        symbol: symbol || null,
        from: from instanceof Date && Number.isFinite(from.getTime()) ? from : null,
        to: to instanceof Date && Number.isFinite(to.getTime()) ? to : null,
        limit
    };
}

function buildWhereClause(filters) {
    const clauses = ["o.environment = $1", "f.id IS NOT NULL"];
    const values = [filters.environment];

    if (filters.accountId) {
        values.push(filters.accountId);
        clauses.push(`o.account_id = $${values.length}`);
    } else {
        if (filters.userId) {
            values.push(filters.userId);
            clauses.push(`o.user_id = $${values.length}`);
        }
    }

    if (filters.strategyId) {
        values.push(filters.strategyId);
        const idx = values.length;
        clauses.push(`(
            LOWER(COALESCE(o.strategy_name, '')) = LOWER($${idx})
            OR LOWER(COALESCE(o.strategy_id::text, '')) = LOWER($${idx})
        )`);
    }
    if (filters.symbol) {
        values.push(filters.symbol);
        clauses.push(`UPPER(o.symbol) = $${values.length}`);
    }
    if (filters.from) {
        values.push(filters.from.toISOString());
        clauses.push(`COALESCE(f.filled_at, o.created_at) >= $${values.length}::timestamptz`);
    }
    if (filters.to) {
        values.push(filters.to.toISOString());
        clauses.push(`COALESCE(f.filled_at, o.created_at) <= $${values.length}::timestamptz`);
    }

    values.push(filters.limit);
    const limitPlaceholder = `$${values.length}`;

    return {
        whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
        values,
        limitPlaceholder
    };
}

function normalizeFillRow(row) {
    return {
        orderId: row.order_id,
        fillId: row.fill_id,
        strategyId: String(row.strategy_name || row.strategy_id || "UNKNOWN"),
        strategyRef: row.strategy_id || null,
        symbol: String(row.symbol || "").toUpperCase(),
        side: String(row.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY",
        quantity: Math.abs(toNum(row.fill_quantity || row.quantity, 0)),
        price: toNum(row.fill_price, 0),
        commission: Math.abs(toNum(row.commission, 0)),
        filledAt: toMs(row.filled_at || row.created_at) || Date.now(),
        status: String(row.status || "FILLED"),
        environment: normalizeEnvironment(row.environment)
    };
}

class TradeHistoryService {
    constructor(pool) {
        this.pool = pool instanceof Pool ? pool : new Pool();
    }

    async getHistoryReport(rawFilters = {}, options = {}) {
        const filters = parseFilters(rawFilters);
        const initialCapital = Math.max(1, Number(options.initialCapital || 10000));

        const hasDb = this.pool && typeof this.pool.query === "function";
        if (!hasDb) {
            return {
                meta: { environment: filters.environment, strategyId: filters.strategyId, symbol: filters.symbol },
                performance: {
                    netProfit: 0, roiPercent: 0, maxDrawdownPercent: 0, totalTrades: 0, winRate: 0,
                    sharpeRatio: 0, profitFactor: 0, grossProfit: 0, grossLoss: 0, avgWin: 0, avgLoss: 0, expectancy: 0
                },
                fills: [],
                trades: [],
                equityCurve: [{ time: Date.now(), equity: initialCapital }],
                analytics: { drawdownCurve: [], returns: [], rollingSharpe: [] }
            };
        }

        const { whereSql, values, limitPlaceholder } = buildWhereClause(filters);
        const sql = `
            SELECT
                o.id AS order_id,
                o.strategy_id,
                o.strategy_name,
                o.symbol,
                o.side,
                o.order_type,
                o.status,
                o.environment,
                o.created_at,
                f.id AS fill_id,
                f.external_deal_id,
                f.fill_price,
                f.fill_quantity,
                f.commission,
                f.filled_at
            FROM orders o
            LEFT JOIN order_fills f ON f.order_id = o.id
            ${whereSql}
            ORDER BY COALESCE(f.filled_at, o.created_at) ASC
            LIMIT ${limitPlaceholder}
        `;
        const { rows } = await this.pool.query(sql, values);
        const fills = (rows || []).map(normalizeFillRow);
        const trades = buildClosedTrades(fills);
        const { performance, analytics } = buildPerformance(trades, initialCapital);
        const strategyName = trades[0]?.strategyId || filters.strategyId || null;

        return {
            meta: {
                id: `hist_${filters.environment.toLowerCase()}_${Date.now()}`,
                strategyName,
                environment: filters.environment,
                strategyId: filters.strategyId,
                symbol: filters.symbol,
                from: filters.from ? filters.from.toISOString() : null,
                to: filters.to ? filters.to.toISOString() : null,
                initialCapital,
                timestamp: new Date().toISOString(),
                executionTime: "streamed"
            },
            performance,
            fills,
            trades,
            equityCurve: analytics.equityCurve,
            analytics: {
                drawdownCurve: analytics.drawdownCurve,
                returns: analytics.returns,
                rollingSharpe: analytics.rollingSharpe
            }
        };
    }
}

module.exports = { TradeHistoryService };
