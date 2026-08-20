"use strict";

const BaseBroker = require("../base/BaseBroker");
const { bus, EVENTS } = require("@events/bus");
const { MetricsAccumulator } = require("@utils/metrics");

class LiveBroker extends BaseBroker {
    constructor(config = {}) {
        super(config);

        const type = config.connectorType || "mt5";
        let connectorPath = "";

        switch (type.toLowerCase()) {
        case "mt5":
        case "mql5":
            connectorPath = "MT5MQL5Connector";
            break;
        case "metaapi":
            connectorPath = "MetaApiConnector";
            break;
        default:
            connectorPath = type.charAt(0).toUpperCase() + type.slice(1) + "Connector";
        }

        try {
            const ConnectorClass = require(`../connectors/${connectorPath}`);
            this.connector = new ConnectorClass({ ...config, userId: this.userId, mode: this.mode });
        } catch (err) {
            throw new Error(`[LiveBroker] Initialization failed: Unable to load connector '${connectorPath}'. ${err.message}`);
        }

        this.lastHeartbeatTime = new Date();
        this._metrics = new MetricsAccumulator();
        this._metrics.init(config.initialCash || 100000);
        this._lastPrice = 0;
        this._ready = true;
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "LIVE").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 100000);
        this.cash = this.initialCash;
        this._metrics = new MetricsAccumulator();
        this._metrics.init(this.initialCash);
        this._ready = true;
        return Promise.resolve();
    }

    async placeOrder(signal) {
        const price = this._lastPrice || 0;
        const qty = Number(signal?.quantity) || 0;
        if (price > 0 && qty > 0 && !this._checkEntryMargin(qty, price)) {
            return { status: "REJECTED", reason: "INSUFFICIENT_MARGIN" };
        }
        return this.connector.executeOrder(signal);
    }

    async closePosition(signal) {
        if (typeof this.connector.liquidatePosition === "function") {
            return this.connector.liquidatePosition(signal.symbol, this.runtimeId);
        }
        return this.connector.executeOrder(signal);
    }

    onFill({ symbol, fillPrice, fillQty, side, commission = 0 }) {
        const qty = Number(fillQty);
        const price = Number(fillPrice);

        if (side.toUpperCase() === "BUY") {
            this.cash -= (qty * price + commission);
            this.positions.applyDelta(symbol, qty, price);
        } else {
            this.cash += (qty * price - commission);
            this.positions.applyDelta(symbol, -qty, price);
        }

        const delta = this.positions.getLastDelta();
        if (delta && delta.realizedPnl && Math.abs(delta.quantityDelta) > 0) {
            const pnl = Number(delta.realizedPnl) || 0;
            const entryPrice = Number(delta.price) || price;
            const entryTime = Date.now() - (delta.price ? 0 : 0);
            this._metrics.recordTrade({
                entryTime: entryTime,
                exitTime: Date.now(),
                direction: delta.resultingSide === "long" ? "LONG" : delta.resultingSide === "short" ? "SHORT" : side.toUpperCase(),
                entryPrice,
                exitPrice: price,
                quantity: Math.abs(delta.quantityDelta),
                profit: pnl,
                profitPct: entryPrice > 0 ? (pnl / (entryPrice * Math.abs(delta.quantityDelta))) * 100 : 0,
                symbol: symbol || this.symbol,
                commissionPaid: Number(commission) || 0
            });

            // Phase E: Emit full metrics snapshot so UI doesn't have to calculate it
            bus.emit(EVENTS.STRATEGY.METRICS_TICK, {
                runtimeId: this.runtimeId,
                metrics: this._metrics.getSnapshot(),
                trade: delta
            });
        }

        this._persist();
        this._emitPortfolioUpdate();
        this._emitBrokerState({ cash: this.cash, initialCash: this.initialCash, config: this.config || {} });
        this._checkMarginGuardrails().catch(() => {});
    }

    getPosition(symbol) {
        const targetSymbol = symbol || this.symbol;
        if (!this.connector) return null;
        const raw = this.connector.getPositionSnapshot(targetSymbol);
        if (!raw) return null;
        if (raw.side) return raw;
        const positions = Array.isArray(raw.positions) ? raw.positions : [];
        const pos = positions.find((p) => (p.symbol || targetSymbol) === targetSymbol) || null;
        return pos || null;
    }

    /**
     * Returns a normalised position snapshot compatible with BaseBroker.getAccountSnapshot()
     * and with MarketFeed._syncPositionSnapshot() so this.pos() works in live strategies.
     */
    getPositionSnapshot(symbol) {
        const targetSymbol = symbol || this.symbol;
        const pos = this.getPosition(targetSymbol);
        let unrealized = 0;

        if (pos && this._lastPrice > 0) {
            const side = String(pos.side || "long").toLowerCase();
            unrealized = side === "long"
                ? (this._lastPrice - (pos.entryPrice || pos.openPrice || 0)) * (pos.quantity || pos.volume || 0)
                : ((pos.entryPrice || pos.openPrice || 0) - this._lastPrice) * (pos.quantity || pos.volume || 0);
        }

        return Object.freeze({
            positions:      pos ? { [targetSymbol]: { ...pos, unrealizedPnl: unrealized } } : {},
            openCount:      pos ? 1 : 0,
            totalUnrealized: unrealized,
        });
    }

    getEquity() {
        // For live mode, prefer the connector's account equity when available.
        if (this.connector && typeof this.connector.getEquity === "function") {
            const eq = this.connector.getEquity();
            if (Number.isFinite(eq) && eq > 0) return eq;
        }
        // Fallback: cash + unrealized from position snapshot
        const snap = this.getPositionSnapshot();
        return this.cash + (snap.totalUnrealized || 0);
    }

    getAccount() {
        const { usedMargin } = this.getMarginStatus();
        const equity = this.getEquity();
        return {
            balance: this.cash,
            equity,
            currency: this.config?.baseCurrency || "USD",
            usedMargin,
            availableMargin: this.cash - usedMargin
        };
    }

    getPerformanceMetrics() {
        return this._metrics.getSnapshot();
    }

    async onBar(bar) {
        if (!bar || !this.connector) return;
        const lastPrice = Number(bar.close || bar.price || 0);
        if (lastPrice > 0) this._lastPrice = lastPrice;
        await this._checkMarginGuardrails();
    }

    async onTick(tick) {
        if (!tick || !this.connector) return;
        const lastPrice = Number(tick.price || tick.bid || 0);
        if (lastPrice > 0) this._lastPrice = lastPrice;
        await this._checkMarginGuardrails();
    }

    resetState() {
        this.cash = this.initialCash;
        this._metrics.init(this.initialCash);
        this._emitBrokerState({ cash: this.cash, initialCash: this.initialCash, config: this.config || {} });
    }

    async destroy() {
        this._ready = false;
        if (typeof this.connector?.disconnect === "function") {
            this.connector.disconnect().catch(() => {});
        }
        if (this._metrics) this._metrics.reset();
    }

    setCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.cash = n;
        this._emitBrokerState({ cash: this.cash });
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

    resetAccount(initialCash) {
        const n = initialCash != null ? Number(initialCash) : this.initialCash || 0;
        this.cash = Number.isFinite(n) ? n : 0;
        this.positions = this.positions && typeof this.positions.clear === "function" ? (this.positions.clear(), this.positions) : this.positions;
        this._emitBrokerState({ cash: this.cash, initialCash: this.initialCash, config: this.config || {} });
    }
}

module.exports = LiveBroker;