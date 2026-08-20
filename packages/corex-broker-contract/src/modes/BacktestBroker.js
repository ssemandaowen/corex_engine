"use strict";

const BaseBroker = require("../base/BaseBroker");
const { bus, EVENTS } = require("@events/bus");
const { MetricsAccumulator } = require("@utils/metrics");

/**
 * Phase 09: BacktestBroker Implementation
 * A synchronous simulation engine for zero-slippage fill testing.
 */
class BacktestBroker extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.initialCash = config.initialCash || 10000;
        this.balance = this.initialCash;
        this.equity = this.balance;
        this.trades = [];
        this.positions = new Map();

        this._metrics = new MetricsAccumulator();
        this._metrics.init(this.initialCash);

        this._lastPrice = 0;
    }

    getPerformanceMetrics() {
        return this._metrics.getSnapshot();
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "BACKTEST").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 10000);
        this.balance = this.initialCash; // Reset balance
        this.equity = this.balance; // Reset equity
        // Re-initialize MetricsAccumulator
        this._metrics = new MetricsAccumulator();
        this._metrics.init(this.initialCash);
        this._ready = true;
        return Promise.resolve();
    }

    async destroy() {
        this._ready = false;
        this.positions.clear();
        // Reset metrics on destroy
        if (this._metrics) {
            this._metrics.reset();
        }
        if (this._metrics) this._metrics.reset();
    }

    async placeOrder(signal) {
        if (!this._ready) return { status: "ERROR", reason: "Broker not ready" };
        const result = this.execute({ ...signal, intent: "ENTER" }, { close: this._lastPrice, time: Date.now() });
        return result || { status: "REJECTED", reason: "No execution result" };
    }

    async closePosition(signal) { // This method is not used by backtestManager.js simulation loop
        if (!this._ready) return { status: "ERROR", reason: "Broker not ready" };
        const result = this.execute({ ...signal, intent: "EXIT" }, { close: this._lastPrice, time: Date.now() });
        return result || { status: "REJECTED", reason: "No execution result" };
    }

    getPosition(symbol) { // This method is not used by backtestManager.js simulation loop
        const target = symbol || this.symbol;
        const pos = this.positions.get(target);
        if (!pos) return null;
        return {
            symbol: target,
            side: pos.side,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            unrealizedPnL: this.getPositionSnapshot(target).totalUnrealized
        };
    }

    getAccount() { // This method is not used by backtestManager.js simulation loop
        const equity = this.getEquity();
        return {
            balance: this.balance,
            equity,
            currency: "USD",
            usedMargin: 0,
            availableMargin: equity
        };
    }

    async onBar(bar) { // This method is called by backtestManager.js simulation loop
        if (!bar) return;
        this._lastPrice = Number(bar.close || bar.price || this._lastPrice) || 0;
    }

    async onTick(tick) { // This method is not used by backtestManager.js simulation loop
        if (!tick) return;
        this._lastPrice = Number(tick.price || tick.bid || this._lastPrice) || 0;
    }

    /**
     * Executes a trade intent synchronously at the close price.
     * Applies slippage, spread, and commission when configured.
     *
     * Backtest realism config (passed via broker.config or backtestManager options):
     *   commissionPct   {number}  Commission as % of trade value. Default 0.
     *                             e.g. 0.1 = 0.1% per side.
     *   slippageBps     {number}  Slippage in basis points. Default 0.
     *                             e.g. 2 = 0.02% adverse slip per fill.
     *   spread          {number}  Half-spread added to entry / subtracted from exit.
     *                             In price units (e.g. 0.00010 for 1 pip on EURUSD).
     *
     * @param {Object} intent
     * @param {Object} marketData  - { close, time, ... }
     */
    execute(intent, marketData) {
        if (!intent || !marketData) return null;

        const rawPrice = marketData.close || marketData.price;
        const symbol   = intent.symbol || this.symbol;
        this._lastPrice = rawPrice;

        // ── Realism adjustments ───────────────────────────────────────────────
        const commPct   = Number(this.config?.commissionPct  ?? 0);
        const slipBps   = Number(this.config?.slippageBps    ?? 0);
        const halfSpread = Number(this.config?.spread        ?? 0) / 2;
        const slipAdj   = rawPrice * (slipBps / 10000);

        if (intent.intent === "ENTER") {
            const qty  = Number(intent.quantity) || 0;
            if (qty <= 0) return null;

            const side = String(intent.side || "long").toLowerCase();

            // Long buys at ask (raw + spread + slip); short sells at bid (raw - spread - slip)
            const fillPrice = side === "long"
                ? rawPrice + halfSpread + slipAdj
                : rawPrice - halfSpread - slipAdj;

            const tradeValue = fillPrice * qty;
            const commission = tradeValue * (commPct / 100);

            this.balance -= tradeValue + commission;

            const posRecord = {
                symbol,
                quantity:   qty,
                side,
                entryPrice: fillPrice,
                timestamp:  marketData.time || Date.now(),
                trailPct:   Number(intent.trailPct  ?? 0) || 0,
                hwm:        fillPrice,   // high-water-mark for long trailing stop
                lwm:        fillPrice,   // low-water-mark for short trailing stop
                commissionPaid: commission,
            };

            this.positions.set(symbol, posRecord);
            return posRecord;
        }

        if (intent.intent === "EXIT") {
            const pos = this.positions.get(symbol);
            if (!pos) return null;

            const side = String(pos.side || "long").toLowerCase();
            const qtyToClose = Number(intent.quantity) || pos.quantity;

            // Long closes at bid (raw - spread - slip); short closes at ask (raw + spread + slip)
            const fillPrice = side === "long"
                ? rawPrice - halfSpread - slipAdj
                : rawPrice + halfSpread + slipAdj;

            const tradeValue = fillPrice * qtyToClose;
            const commission = tradeValue * (commPct / 100);

            const pnl = side === "long"
                ? (fillPrice - pos.entryPrice) * qtyToClose
                : (pos.entryPrice - fillPrice) * qtyToClose;

            // Return original entry capital + pnl, minus exit commission
            this.balance += (pos.entryPrice * qtyToClose) + pnl - commission;

            const exitRecord = {
                type:      "FILL_EXIT",
                symbol,
                quantity:  qtyToClose,
                price:     fillPrice,
                pnl,
                timestamp: marketData.time || Date.now(),
            };

            this.positions.delete(symbol);

            this._metrics.recordTrade({
                entryTime:     pos.timestamp,
                exitTime:      marketData.time || Date.now(),
                direction:     side,
                entryPrice:    pos.entryPrice,
                exitPrice:     fillPrice,
                quantity:      qtyToClose,
                profit:        pnl - (pos.commissionPaid ?? 0) - commission,
                profitPct:     pos.entryPrice > 0
                    ? (pnl / (pos.entryPrice * qtyToClose)) * 100
                    : 0,
                symbol,
                commissionPaid: (pos.commissionPaid ?? 0) + commission,
            });

            return exitRecord;
        }

        return null;
    }

    getPositionSnapshot(symbol) {
        const targetSymbol = symbol || this.symbol;
        const pos = this.positions.get(targetSymbol);
        
        let unrealized = 0;
        if (pos && this._lastPrice > 0) {
            unrealized = pos.side === "long" 
                ? (this._lastPrice - pos.entryPrice) * pos.quantity 
                : (pos.entryPrice - this._lastPrice) * pos.quantity;
        }

        const snapshot = {
            positions: pos ? { [targetSymbol]: { ...pos, unrealizedPnl: unrealized } } : {},
            openCount: this.positions.size,
            totalUnrealized: unrealized
        };

        return Object.freeze(snapshot);
    }

    getEquity() {
        const snapshot = this.getPositionSnapshot();
        return this.balance + snapshot.totalUnrealized;
    }

    resetState() {
        this.balance = this.initialCash;
        this.equity = this.balance;
        this.positions.clear();
        this._metrics.init(this.initialCash);
        this._lastPrice = 0;
        // Persist reset state
        this._emitBrokerState({ cash: this.balance, initialCash: this.initialCash, config: this.config || {} });
    }

    setCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.balance = n;
        this._emitBrokerState({ cash: this.balance });
        return true;
    }

    setInitialCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.initialCash = n;
        this._emitBrokerState({ initialCash: this.initialCash });
        return true;
    }

    updateConfig(next) {
        if (!next || typeof next !== "object") return false;
        this.config = { ...(this.config || {}), ...next };
        this._emitBrokerState({ config: this.config });
        return true;
    }
}

module.exports = BacktestBroker;