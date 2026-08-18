"use strict";

/**
 * A simple class for tracking metrics like counts and drops, both globally and for individual items.
 */
class Metrics {
    constructor() {
        this.total = 0;
        this.dropped = 0;
        this.lastAt = 0;
        this.startedAt = Date.now();
        this.items = new Map(); // For per-item stats
    }

    /**
     * Ensures an entry for a given key exists in the items map.
     * @param {*} key The key for the item.
     * @returns {object} The stats object for the item.
     * @private
     */
    _ensureItem(key) {
        if (!this.items.has(key)) {
            this.items.set(key, { count: 0, dropped: 0, lastAt: 0 });
        }
        return this.items.get(key);
    }

    /**
     * Records a successful event for a given item key.
     * @param {*} key The key of the item to record.
     */
    record(key) {
        this.total++;
        this.lastAt = Date.now();
        const item = this._ensureItem(key);
        item.count++;
        item.lastAt = this.lastAt;
    }

    /**
     * Records a dropped event for a given item key.
     * @param {*} key The key of the item to record as dropped.
     */
    recordDrop(key) {
        this.dropped++;
        const item = this._ensureItem(key);
        item.dropped++;
    }

    /**
     * Returns a snapshot of the current metrics.
     * @returns {object} A snapshot of the metrics.
     */
    getSnapshot() {
        const items = [];
        for (const [key, value] of this.items.entries()) {
            items.push({ key, ...value });
        }
        return {
            total: this.total,
            dropped: this.dropped,
            lastAt: this.lastAt,
            items
        };
    }

    /**
     * Resets all metrics to their initial state.
     */
    reset() {
        this.total = 0;
        this.dropped = 0;
        this.lastAt = 0;
        this.startedAt = Date.now();
        this.items.clear();
    }
}

module.exports = Metrics;

class TradeRecord {
    constructor({ entryTime, exitTime, direction, entryPrice, exitPrice, quantity, profit, profitPct, symbol, commissionPaid }) {
        this.entryTime = entryTime;
        this.exitTime = exitTime;
        this.direction = direction;
        this.entryPrice = entryPrice;
        this.exitPrice = exitPrice;
        this.quantity = quantity;
        this.profit = profit;
        this.profitPct = profitPct;
        this.symbol = symbol;
        this.commissionPaid = commissionPaid;
    }
}

class MetricsAccumulator {
    constructor() {
        this.init(0);
    }

    init(initialCapital) {
        this._initialCapital = Number(initialCapital) || 0;
        this._currentEquity = this._initialCapital;
        this.reset();
    }

    recordTrade(trade) {
        if (!trade) return;

        const profit = Number(trade.profit) || 0;
        const profitPct = Number(trade.profitPct) || 0;

        const rec = new TradeRecord({
            entryTime: trade.entryTime || 0,
            exitTime: trade.exitTime || Date.now(),
            direction: trade.direction || "LONG",
            entryPrice: Number(trade.entryPrice) || 0,
            exitPrice: Number(trade.exitPrice) || 0,
            quantity: Number(trade.quantity) || 0,
            profit,
            profitPct,
            symbol: trade.symbol || "",
            commissionPaid: trade.commissionPaid != null ? Number(trade.commissionPaid) : null
        });
        this._trades.push(rec);

        this._currentEquity += profit;
        this._equityCurve.push({ time: rec.exitTime, equity: this._currentEquity });

        if (this._currentEquity > this._peakEquity) {
            this._peakEquity = this._currentEquity;
        }

        const drawdown = this._peakEquity - this._currentEquity;
        if (drawdown > this._maxDrawdown) this._maxDrawdown = drawdown;

        const drawdownPct = this._peakEquity > 0 ? (drawdown / this._peakEquity) * 100 : 0;
        if (drawdownPct > this._maxDrawdownPct) this._maxDrawdownPct = drawdownPct;

        if (profitPct !== 0) {
            const ret = profitPct / 100;
            this._sumReturns += ret;
            this._sumSqReturns += ret * ret;
            this._returnsCount++;
        }
    }

    getSnapshot() {
        const totalTrades = this._trades.length;
        const wins = this._trades.filter(t => t.profit > 0);
        const losses = this._trades.filter(t => t.profit <= 0);
        const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
        const netProfit = this._currentEquity - this._initialCapital;
        const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
        const roiPercent = this._initialCapital > 0 ? (netProfit / this._initialCapital) * 100 : 0;

        let sharpe = 0;
        if (this._returnsCount > 0) {
            const n = this._returnsCount;
            const mean = this._sumReturns / n;
            const variance = Math.max(0, (this._sumSqReturns / n) - (mean * mean));
            const std = Math.sqrt(variance);
            sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
        }

        return {
            netProfit,
            grossProfit,
            grossLoss,
            totalTrades,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate,
            profitFactor,
            maxDrawdown: this._maxDrawdown,
            maxDrawdownPercent: this._maxDrawdownPct,
            sharpeRatio: sharpe,
            roiPercent,
            equityCurve: [...this._equityCurve],
            trades: this._trades.map(t => ({
                entryTime: t.entryTime,
                exitTime: t.exitTime,
                direction: t.direction,
                entryPrice: t.entryPrice,
                exitPrice: t.exitPrice,
                quantity: t.quantity,
                profit: t.profit,
                profitPct: t.profitPct,
                symbol: t.symbol,
                commissionPaid: t.commissionPaid
            }))
        };
    }

    reset() {
        this._trades = [];
        this._currentEquity = this._initialCapital;
        this._peakEquity = this._initialCapital;
        this._maxDrawdown = 0;
        this._maxDrawdownPct = 0;
        this._sumReturns = 0;
        this._sumSqReturns = 0;
        this._returnsCount = 0;
        this._equityCurve = [{ time: Date.now(), equity: this._initialCapital }];
    }

    _computeEquity() {
        return this._currentEquity;
    }
}

module.exports.MetricsAccumulator = MetricsAccumulator;
module.exports.TradeRecord = TradeRecord;
