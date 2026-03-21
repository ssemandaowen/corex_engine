"use strict";

const db = require("@core/services/postgres");

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

const buildEquityAnalytics = (initialCapital, trades = [], fallbackTime = Date.now()) => {
    const points = [{
        time: Number(fallbackTime),
        equity: Number(initialCapital)
    }];

    const sorted = [...trades]
        .map((t) => ({
            ...t,
            profit: toNum(t?.profit, 0),
            exitTs: toNum(t?.exitTime, toNum(t?.entryTime, fallbackTime))
        }))
        .filter((t) => Number.isFinite(t.exitTs))
        .sort((a, b) => a.exitTs - b.exitTs);

    let equity = Number(initialCapital);
    for (const t of sorted) {
        equity += Number.isFinite(t.profit) ? t.profit : 0;
        points.push({ time: t.exitTs, equity: Number(equity) });
    }

    let peak = points[0]?.equity || Number(initialCapital);
    const drawdownCurve = points.map((p) => {
        if (p.equity > peak) peak = p.equity;
        const drawdown = peak > 0 ? ((p.equity / peak) - 1) * 100 : 0;
        return { time: p.time, drawdown };
    });

    const returns = [];
    for (let i = 1; i < points.length; i += 1) {
        const prev = Number(points[i - 1].equity || 0);
        const cur = Number(points[i].equity || 0);
        if (prev !== 0) {
            returns.push({ time: points[i].time, value: (cur / prev) - 1 });
        }
    }

    const rollingWindow = 20;
    const rollingSharpe = [];
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < returns.length; i += 1) {
        const r = Number(returns[i].value || 0);
        sum += r;
        sumSq += r * r;
        if (i >= rollingWindow) {
            const old = Number(returns[i - rollingWindow].value || 0);
            sum -= old;
            sumSq -= old * old;
        }
        if (i >= rollingWindow - 1) {
            const n = rollingWindow;
            const mean = sum / n;
            const variance = Math.max(0, (sumSq / n) - (mean * mean));
            const std = Math.sqrt(variance);
            const sharpe = std === 0 ? 0 : (mean / std) * Math.sqrt(n);
            rollingSharpe.push({ time: returns[i].time, sharpe });
        }
    }

    return {
        equityCurve: points,
        drawdownCurve,
        returns,
        rollingSharpe
    };
};

function parseFilters(raw = {}) {
    const userId = String(raw.userId || "").trim();
    const environment = normalizeEnvironment(raw.environment);
    const strategyId = String(raw.strategyId || "").trim();
    const symbol = String(raw.symbol || "").trim().toUpperCase();
    const from = raw.from ? new Date(raw.from) : null;
    const to = raw.to ? new Date(raw.to) : null;
    const limitRaw = Number(raw.limit || 2000);
    const limit = Math.max(1, Math.min(10000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 2000));

    return {
        userId: userId || null,
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

    if (filters.userId) {
        values.push(filters.userId);
        clauses.push(`o.user_id = $${values.length}`);
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

function buildClosedTrades(fills = []) {
    const sorted = [...fills]
        .filter((f) => f.quantity > 0 && f.price > 0)
        .sort((a, b) => a.filledAt - b.filledAt);

    const positions = new Map();
    const closed = [];

    for (const f of sorted) {
        const key = `${f.strategyId}::${f.symbol}`;
        const incomingSide = f.side === "BUY" ? "long" : "short";
        const oppositeSide = incomingSide === "long" ? "short" : "long";
        const incomingQtyOriginal = f.quantity;
        let remainingQty = f.quantity;
        let remainingCommission = f.commission;

        const current = positions.get(key);
        if (!current) {
            positions.set(key, {
                side: incomingSide,
                quantity: remainingQty,
                avgPrice: f.price,
                entryTime: f.filledAt,
                entryCommission: remainingCommission
            });
            continue;
        }

        if (current.side === incomingSide) {
            const totalQty = current.quantity + remainingQty;
            const weightedPrice = totalQty > 0
                ? ((current.avgPrice * current.quantity) + (f.price * remainingQty)) / totalQty
                : f.price;
            current.avgPrice = weightedPrice;
            current.quantity = totalQty;
            current.entryCommission += remainingCommission;
            positions.set(key, current);
            continue;
        }

        while (remainingQty > 0 && current.quantity > 0 && current.side === oppositeSide) {
            const closeQty = Math.min(current.quantity, remainingQty);
            const exitCommissionPortion = incomingQtyOriginal > 0
                ? (f.commission * (closeQty / incomingQtyOriginal))
                : 0;
            const entryCommissionPortion = current.quantity > 0
                ? (current.entryCommission * (closeQty / current.quantity))
                : 0;

            const grossPnl = current.side === "long"
                ? ((f.price - current.avgPrice) * closeQty)
                : ((current.avgPrice - f.price) * closeQty);

            const totalCommission = entryCommissionPortion + exitCommissionPortion;
            const profit = grossPnl - totalCommission;
            const entryNotional = current.avgPrice * closeQty;
            const profitPct = entryNotional > 0 ? (profit / entryNotional) * 100 : 0;

            closed.push({
                strategyId: f.strategyId,
                symbol: f.symbol,
                direction: current.side,
                quantity: Number(closeQty.toFixed(8)),
                entryPrice: Number(current.avgPrice.toFixed(8)),
                exitPrice: Number(f.price.toFixed(8)),
                entryTime: current.entryTime,
                exitTime: f.filledAt,
                commission: Number(totalCommission.toFixed(8)),
                profit: Number(profit.toFixed(8)),
                profitPct: Number(profitPct.toFixed(8))
            });

            current.entryCommission = Math.max(0, current.entryCommission - entryCommissionPortion);
            current.quantity = Math.max(0, current.quantity - closeQty);
            remainingQty = Math.max(0, remainingQty - closeQty);
            remainingCommission = Math.max(0, remainingCommission - exitCommissionPortion);

            if (current.quantity <= 0) break;
        }

        if (current.quantity <= 0) {
            positions.delete(key);
        } else {
            positions.set(key, current);
        }

        if (remainingQty > 0) {
            positions.set(key, {
                side: incomingSide,
                quantity: remainingQty,
                avgPrice: f.price,
                entryTime: f.filledAt,
                entryCommission: remainingCommission
            });
        }
    }

    return closed;
}

function buildPerformance(trades = [], initialCapital = 10000) {
    const safeTrades = Array.isArray(trades) ? trades : [];
    const netProfit = safeTrades.reduce((acc, t) => acc + toNum(t.profit, 0), 0);
    const wins = safeTrades.filter((t) => toNum(t.profit, 0) > 0).length;
    const losses = safeTrades.filter((t) => toNum(t.profit, 0) < 0).length;
    const winRate = safeTrades.length > 0 ? (wins / safeTrades.length) * 100 : 0;
    const grossProfit = safeTrades.filter((t) => toNum(t.profit, 0) > 0).reduce((s, t) => s + toNum(t.profit, 0), 0);
    const grossLoss = Math.abs(safeTrades.filter((t) => toNum(t.profit, 0) < 0).reduce((s, t) => s + toNum(t.profit, 0), 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : 0;
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const expectancy = ((winRate / 100) * avgWin) - ((1 - (winRate / 100)) * avgLoss);

    const analytics = buildEquityAnalytics(initialCapital, safeTrades, safeTrades[0]?.entryTime || Date.now());
    const maxDrawdown = Math.min(0, ...analytics.drawdownCurve.map((p) => toNum(p.drawdown, 0)));

    return {
        performance: {
            netProfit: Number(netProfit.toFixed(8)),
            roiPercent: initialCapital > 0 ? Number(((netProfit / initialCapital) * 100).toFixed(8)) : 0,
            maxDrawdownPercent: Number(maxDrawdown.toFixed(8)),
            totalTrades: safeTrades.length,
            winRate: Number(winRate.toFixed(8)),
            sharpeRatio: Number((analytics.rollingSharpe[analytics.rollingSharpe.length - 1]?.sharpe || 0).toFixed(8)),
            profitFactor: Number(profitFactor.toFixed(8)),
            grossProfit: Number(grossProfit.toFixed(8)),
            grossLoss: Number(grossLoss.toFixed(8)),
            avgWin: Number(avgWin.toFixed(8)),
            avgLoss: Number(avgLoss.toFixed(8)),
            expectancy: Number(expectancy.toFixed(8))
        },
        analytics
    };
}

class TradeHistoryService {
    async getHistoryReport(rawFilters = {}, options = {}) {
        const filters = parseFilters(rawFilters);
        const initialCapital = Math.max(1, Number(options.initialCapital || 10000));
        if (!db.hasDbConfig()) {
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
        const { rows } = await db.query(sql, values);
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

module.exports = new TradeHistoryService();
