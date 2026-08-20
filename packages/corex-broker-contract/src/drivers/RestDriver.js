"use strict";

const BaseBroker = require("../base/BaseBroker");
const UnsupportedOperationError = require("../base/UnsupportedOperationError");
const SymbolNormalizer = require("../utils/SymbolNormalizer");
const mt5Bridge = require("../mt5Bridge");
const { bus, EVENTS } = require("@events/bus");
const { MetricsAccumulator } = require("@utils/metrics");

class RestDriver extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.supports_trading = true;
        this.supports_streaming_data = false;

        this._lastPrice = 0;
        this._metrics = new MetricsAccumulator();
        this._metrics.init(config.initialCash || 100000);
    }

    async submit(payload) {
        if (!this._ready) return { status: "REJECTED", reason: "Broker not ready" };

        if (!mt5Bridge.isConnected()) {
            return {
                orderId: `rejected_${Date.now()}`,
                status: "REJECTED",
                reason: "MT5 bridge not connected",
                avgFillPrice: 0,
                filled: 0,
                remaining: Number(payload.Volume || 0),
                commission: 0,
                timestamp: Date.now(),
                side: String(payload.Side || "BUY").toUpperCase(),
                symbol: payload.Symbol,
                raw: { bridgeConnected: false }
            };
        }

        const { symbol } = SymbolNormalizer.normalize(payload.Symbol);
        const side = String(payload.Side || "BUY").toUpperCase();
        const actionType = side === "SELL" ? "SELL" : "BUY";

        const orderPayload = {
            action: actionType,
            symbol: symbol,
            volume: Number(payload.Volume || 0),
            sl: Number(payload.StopLoss || 0) || 0,
            tp: Number(payload.TakeProfit || 0) || 0,
            comment: String(this.runtimeId)
        };

        try {
            const response = await mt5Bridge.request("order", orderPayload);

            if (!response || response.retcode !== 0) {
                return {
                    orderId: `rejected_${Date.now()}`,
                    status: "REJECTED",
                    reason: response?.comment || "Terminal connection rejected order placement.",
                    avgFillPrice: 0,
                    filled: 0,
                    remaining: Number(payload.Volume || 0),
                    commission: 0,
                    timestamp: Date.now(),
                    side,
                    symbol,
                    raw: response
                };
            }

            bus.emit(EVENTS.BROKER.STATE_CHANGED, {
                userId: this.userId,
                mode: this.mode,
                payload: {}
            });

            return {
                orderId: response.order_ticket || `mt5_${Date.now()}`,
                status: "FILLED",
                avgFillPrice: Number(response.price || payload.Price || 0),
                filled: Number(payload.Volume || 0),
                remaining: 0,
                commission: 0,
                timestamp: Date.now(),
                side,
                symbol,
                raw: response
            };
        } catch (error) {
            return {
                orderId: `error_${Date.now()}`,
                status: "REJECTED",
                reason: error.message,
                avgFillPrice: 0,
                filled: 0,
                remaining: Number(payload.Volume || 0),
                commission: 0,
                timestamp: Date.now(),
                side,
                symbol,
                raw: null
            };
        }
    }

    async modify(orderId, changes) {
        if (mt5Bridge.isConnected()) {
            const result = await mt5Bridge.request("modify", { ...changes, order_ticket: orderId });
            return { status: result?.retcode === 0 ? "MODIFIED" : "REJECTED", orderId, raw: result };
        }
        throw new UnsupportedOperationError("RestDriver modify: MT5 bridge not connected");
    }

    async cancel(orderId) {
        if (mt5Bridge.isConnected()) {
            const result = await mt5Bridge.request("cancel", { order_ticket: orderId });
            return { status: result?.retcode === 0 ? "CANCELED" : "REJECTED", orderId, raw: result };
        }
        throw new UnsupportedOperationError("RestDriver cancel: MT5 bridge not connected");
    }

    async query_status(orderId) {
        if (mt5Bridge.isConnected()) {
            const result = await mt5Bridge.request("status", { order_ticket: orderId });
            return { status: result?.retcode === 0 ? "FOUND" : "NOT_FOUND", orderId, raw: result };
        }
        throw new UnsupportedOperationError("RestDriver query_status: MT5 bridge not connected");
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "LIVE").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 100000);
        this._ready = true;
        return Promise.resolve();
    }

    async destroy() {
        this._ready = false;
    }

    getPosition(symbol) {
        const positions = mt5Bridge.getPositions() || [];
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        return positions.find((p) => SymbolNormalizer.normalize(p.symbol).symbol === canonical) || null;
    }

    getAccount() {
        const snap = mt5Bridge.getAccountSnapshot();
        if (snap) {
            return {
                balance: snap.balance || 0,
                equity: snap.equity || 0,
                currency: snap.currency || "USD",
                usedMargin: snap.margin || 0,
                availableMargin: (snap.balance || 0) - (snap.margin || 0)
            };
        }
        return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 };
    }

    getEquity() {
        const snap = mt5Bridge.getAccountSnapshot();
        return snap?.equity || 0;
    }

    getPositionSnapshot(symbol) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        const positions = mt5Bridge.getPositions() || [];
        const pos = positions.find((p) => SymbolNormalizer.normalize(p.symbol).symbol === canonical);
        let unrealized = 0;

        if (pos && this._lastPrice > 0) {
            const entryPrice = pos.entryPrice || pos.openPrice || 0;
            unrealized = pos.side === "BUY" || pos.side === "LONG" || pos.side === "long"
                ? (this._lastPrice - entryPrice) * pos.volume
                : (entryPrice - this._lastPrice) * pos.volume;
        }

        return Object.freeze({
            positions: pos ? { [canonical]: { ...pos, unrealizedPnl: unrealized } } : {},
            openCount: pos ? 1 : 0,
            totalUnrealized: unrealized
        });
    }

    getPerformanceMetrics() {
        return this._metrics.getSnapshot();
    }

    async onBar(bar) {
        if (!bar) return;
        this._lastPrice = Number(bar.close || bar.price || this._lastPrice) || 0;
    }

    async onTick(tick) {
        if (!tick) return;
        this._lastPrice = Number(tick.price || tick.bid || this._lastPrice) || 0;
    }

    resetState() {
        this._metrics.init(this.initialCash || 100000);
        this._lastPrice = 0;
    }

    setCash() {
        return false;
    }

    setInitialCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.initialCash = n;
        return true;
    }

    updateConfig(next) {
        if (!next || typeof next !== "object") return false;
        this.config = { ...(this.config || {}), ...next };
        if (typeof mt5Bridge.applyRuntimeConfig === "function") {
            mt5Bridge.applyRuntimeConfig(this.config);
        }
        return true;
    }

    resetAccount() {
        return false;
    }
}

module.exports = RestDriver;
