"use strict";

const BaseBroker = require("../base/BaseBroker");
const UnsupportedOperationError = require("../base/UnsupportedOperationError");
const SharedFillSim = require("../utils/SharedFillSim");
const SymbolNormalizer = require("../utils/SymbolNormalizer");
const { MetricsAccumulator } = require("@utils/metrics");

class BacktestDriver extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.supports_trading = true;
        this.supports_streaming_data = true;

        this.initialCash = Number(config.initialCash || config.initialBalance || 10000);
        this.balance = this.initialCash;
        this.equity = this.balance;
        this.trades = [];
        this.positions = new Map();
        this._lastPrice = 0;

        this._fillSim = new SharedFillSim({
            commissionPct: config.brokerConfig?.commissionPct || config.commissionPct || 0,
            slippageBps: config.brokerConfig?.slippageBps || config.slippageBps || 0,
            spread: config.brokerConfig?.spread || config.spread || 0,
            fillPolicy: config.brokerConfig?.fillPolicy || "next_bar",
            useATR: config.brokerConfig?.useATR || false
        });

        this._metrics = new MetricsAccumulator();
        this._metrics.init(this.initialCash);
    }

    async submit(payload) {
        if (!this._ready) return { status: "REJECTED", reason: "Broker not ready" };

        const { symbol: rawSymbol, pipScale } = SymbolNormalizer.normalize(payload.Symbol);
        const side = String(payload.Side || "BUY").toUpperCase();
        const orderType = String(payload.OrderType || "MARKET").toUpperCase();
        const quantity = Number(payload.Volume || 0);

        if (!quantity || quantity <= 0) {
            return { status: "REJECTED", reason: "Invalid quantity", orderId: `reject_${Date.now()}` };
        }

        const entryPrice = orderType === "MARKET"
            ? this._lastPrice
            : (Number(payload.Price) || 0);

        const notional = quantity * entryPrice;
        const commission = entryPrice > 0 ? this._fillSim.calculateCommission(notional) : 0;

        this.balance -= notional + commission;

        const posRecord = {
            symbol: rawSymbol,
            quantity,
            side: side === "SELL" ? "short" : "long",
            entryPrice,
            timestamp: Date.now(),
            commissionPaid: commission,
            pipScale,
            trailPct: Number(payload.trailPct || 0) || 0,
            sl: Number(payload.StopLoss || 0) || 0,
            tp: Number(payload.TakeProfit || 0) || 0,
            hwm: entryPrice,
            lwm: entryPrice
        };

        this.positions.set(rawSymbol, posRecord);

        return {
            orderId: `fill_${Date.now()}`,
            status: "FILLED",
            avgFillPrice: Number(entryPrice.toFixed(8)),
            filled: quantity,
            remaining: 0,
            commission,
            timestamp: Date.now(),
            side,
            symbol: rawSymbol,
            raw: { entryPrice, pipScale }
        };
    }

    async modify(orderId, changes) {
        throw new UnsupportedOperationError("BacktestDriver does not support order modification");
    }

    async cancel(orderId) {
        throw new UnsupportedOperationError("BacktestDriver does not support order cancellation");
    }

    async query_status(orderId) {
        throw new UnsupportedOperationError("BacktestDriver does not support order status queries");
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "BACKTEST").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 10000);
        this.balance = this.initialCash;
        this.equity = this.balance;
        this._metrics = new MetricsAccumulator();
        this._metrics.init(this.initialCash);
        this._ready = true;
        return Promise.resolve();
    }

    async destroy() {
        this._ready = false;
        this.positions.clear();
        if (this._metrics) this._metrics.reset();
    }

    getPosition(symbol) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        const pos = this.positions.get(canonical);
        if (!pos) return null;
        return {
            symbol: canonical,
            side: pos.side,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            unrealizedPnL: this._computeUnrealized(pos)
        };
    }

    _computeUnrealized(pos) {
        if (!pos || !this._lastPrice) return 0;
        return pos.side === "long"
            ? (this._lastPrice - pos.entryPrice) * pos.quantity
            : (pos.entryPrice - this._lastPrice) * pos.quantity;
    }

    getAccount() {
        const equity = this.getEquity();
        return {
            balance: this.balance,
            equity,
            currency: "USD",
            usedMargin: 0,
            availableMargin: equity
        };
    }

    getPerformanceMetrics() {
        return this._metrics.getSnapshot();
    }

    getEquity() {
        const snapshot = this.getPositionSnapshot();
        return this.balance + snapshot.totalUnrealized;
    }

    getPositionSnapshot(symbol) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        const pos = this.positions.get(canonical);
        let unrealized = 0;

        if (pos && this._lastPrice > 0) {
            unrealized = pos.side === "long"
                ? (this._lastPrice - pos.entryPrice) * pos.quantity
                : (pos.entryPrice - this._lastPrice) * pos.quantity;
        }

        const snapshot = {
            positions: pos ? { [canonical]: { ...pos, unrealizedPnl: unrealized } } : {},
            openCount: this.positions.size,
            totalUnrealized: unrealized
        };
        return Object.freeze(snapshot);
    }

    async onBar(bar) {
        if (!bar) return;
        this._lastPrice = Number(bar.close || bar.price || this._lastPrice) || 0;
    }

    async onTick(tick) {
        if (!tick) return;
        this._lastPrice = Number(tick.price || tick.bid || this._lastPrice) || 0;
    }

    execute(intent, marketData) {
        if (!intent || !marketData) return null;

        const rawPrice = marketData.close || marketData.price;
        const symbol = intent.symbol || this.symbol;
        this._lastPrice = rawPrice;

        const commPct = Number(this.config?.commissionPct ?? 0);
        const slipBps = Number(this.config?.slippageBps ?? 0);
        const halfSpread = Number(this.config?.spread ?? 0) / 2;
        const slipAdj = rawPrice * (slipBps / 10000);

        if (intent.intent === "ENTER") {
            const qty = Number(intent.quantity) || 0;
            if (qty <= 0) return null;

            const side = String(intent.side || "long").toLowerCase();
            const fillPrice = side === "long"
                ? rawPrice + halfSpread + slipAdj
                : rawPrice - halfSpread - slipAdj;

            const tradeValue = fillPrice * qty;
            const commission = tradeValue * (commPct / 100);

            this.balance -= tradeValue + commission;

            const posRecord = {
                symbol,
                quantity: qty,
                side,
                entryPrice: fillPrice,
                timestamp: marketData.time || Date.now(),
                trailPct: Number(intent.trailPct ?? 0) || 0,
                hwm: fillPrice,
                lwm: fillPrice,
                commissionPaid: commission
            };

            this.positions.set(symbol, posRecord);
            return posRecord;
        }

        if (intent.intent === "EXIT") {
            const pos = this.positions.get(symbol);
            if (!pos) return null;

            const side = String(pos.side || "long").toLowerCase();
            const qtyToClose = Number(intent.quantity) || pos.quantity;
            const fillPrice = side === "long"
                ? rawPrice - halfSpread - slipAdj
                : rawPrice + halfSpread + slipAdj;

            const tradeValue = fillPrice * qtyToClose;
            const commission = tradeValue * (commPct / 100);

            const pnl = side === "long"
                ? (fillPrice - pos.entryPrice) * qtyToClose
                : (pos.entryPrice - fillPrice) * qtyToClose;

            this.balance += (pos.entryPrice * qtyToClose) + pnl - commission;

            const exitRecord = {
                type: "FILL_EXIT",
                symbol,
                quantity: qtyToClose,
                price: fillPrice,
                pnl,
                timestamp: marketData.time || Date.now()
            };

            this.positions.delete(symbol);

            this._metrics.recordTrade({
                entryTime: pos.timestamp,
                exitTime: marketData.time || Date.now(),
                direction: side,
                entryPrice: pos.entryPrice,
                exitPrice: fillPrice,
                quantity: qtyToClose,
                profit: pnl - (pos.commissionPaid ?? 0) - commission,
                profitPct: pos.entryPrice > 0
                    ? (pnl / (pos.entryPrice * qtyToClose)) * 100
                    : 0,
                symbol,
                commissionPaid: (pos.commissionPaid ?? 0) + commission
            });

            return exitRecord;
        }

        return null;
    }

    resetState() {
        this.balance = this.initialCash;
        this.equity = this.balance;
        this.positions.clear();
        this.trades = [];
        this._metrics.init(this.initialCash);
        this._lastPrice = 0;
        this._fillSim = new SharedFillSim({
            commissionPct: this.config?.commissionPct || 0,
            slippageBps: this.config?.slippageBps || 0,
            spread: this.config?.spread || 0
        });
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
        if (this._fillSim) {
            this._fillSim.commissionPct = this.config.commissionPct || 0;
            this._fillSim.slippageBps = this.config.slippageBps || 0;
            this._fillSim.spread = this.config.spread || 0;
        }
        this._emitBrokerState({ config: this.config });
        return true;
    }
}

module.exports = BacktestDriver;
