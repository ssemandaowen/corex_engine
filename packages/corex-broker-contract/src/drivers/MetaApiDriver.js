"use strict";

const BaseBroker = require("../base/BaseBroker");
const UnsupportedOperationError = require("../base/UnsupportedOperationError");
const SymbolNormalizer = require("../utils/SymbolNormalizer");
const { MetricsAccumulator } = require("@utils/metrics");

class MetaApiDriver extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.supports_trading = true;
        this.supports_streaming_data = false;

        this.connectorType = config.connectorType || "metaapi";
        this._lastPrice = 0;
        this.trades = [];
        this.cash = 0; // Legacy — broker owns state in live mode; use _cachedEquity/_cachedAccount instead
        this._metrics = new MetricsAccumulator();
        this._metrics.init(config.initialCash || 100000);

        // Cached state from the external broker (updated via push events / refreshState).
        // Per spec #7: Live mode — the real broker owns the ledger. The session queries
        // or listens to that external broker only; no CoreX-side ledger for live.
        this._cachedEquity = 0;
        this._cachedPositions = {};
        this._cachedAccount = null;

        try {
            const ConnectorClass = require("../connectors/MetaApiConnector");
            this.connector = new ConnectorClass({ ...config, userId: this.userId, mode: this.mode });
        } catch (err) {
            throw new Error(`[MetaApiDriver] Initialization failed: Unable to load connector 'MetaApiConnector'. ${err.message}`);
        }
    }

    async submit(payload) {
        if (!this._ready) return { status: "REJECTED", reason: "Broker not ready" };

        const { symbol } = SymbolNormalizer.normalize(payload.Symbol);
        const side = String(payload.Side || "BUY").toUpperCase();
        const quantity = Number(payload.Volume || 0);

        if (this.connector && typeof this.connector.executeOrder === "function") {
            const connectorResult = await this.connector.executeOrder({
                intent: "ENTER",
                symbol,
                side: side === "SELL" ? "short" : "long",
                quantity,
                price: payload.Price,
                sl: payload.StopLoss,
                tp: payload.TakeProfit
            });

            if (connectorResult.success) {
                this._emitBrokerState({ symbol, side, quantity });
                return {
                    orderId: connectorResult.orderId || `metaapi_${Date.now()}`,
                    status: "FILLED",
                    avgFillPrice: Number(connectorResult.executionPrice || payload.Price || 0),
                    filled: quantity,
                    remaining: 0,
                    commission: 0,
                    timestamp: Date.now(),
                    side,
                    symbol,
                    raw: connectorResult
                };
            }
            return {
                orderId: `rejected_${Date.now()}`,
                status: "REJECTED",
                avgFillPrice: 0,
                filled: 0,
                remaining: quantity,
                commission: 0,
                timestamp: Date.now(),
                side,
                symbol,
                raw: connectorResult
            };
        }

        throw new UnsupportedOperationError("MetaApiDriver connector does not support order execution");
    }

    async modify(orderId, changes) {
        throw new UnsupportedOperationError("MetaApiDriver does not support order modification");
    }

    async cancel(orderId) {
        throw new UnsupportedOperationError("MetaApiDriver does not support order cancellation");
    }

    async query_status(orderId) {
        throw new UnsupportedOperationError("MetaApiDriver does not support order status queries");
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "LIVE").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 100000);

        await this.refreshState();
        this._ready = true;
        return Promise.resolve();
    }

    async refreshState() {
        if (!this.connector) return;
        try {
            if (typeof this.connector.getEquity === "function") {
                const eq = await this.connector.getEquity();
                if (Number.isFinite(eq)) this._cachedEquity = eq;
            }
            if (typeof this.connector.getPositionSnapshot === "function") {
                const snap = await this.connector.getPositionSnapshot(this.symbol);
                if (snap && typeof snap === "object") {
                    this._cachedPositions = snap.positions || {};
                }
            }
            if (typeof this.connector.getAccountSnapshot === "function") {
                const acc = await this.connector.getAccountSnapshot();
                if (acc && typeof acc === "object") this._cachedAccount = acc;
            }
        } catch (err) {
            // Spec #8/#10: provider errors caught and logged, never surfaced.
            // Push-based updates will eventually correct cached state.
        }
    }

    async destroy() {
        this._ready = false;
        if (typeof this.connector?.disconnect === "function") {
            this.connector.disconnect().catch(() => {});
        }
        if (this._metrics) this._metrics.reset();
        this._cachedEquity = 0;
        this._cachedPositions = {};
        this._cachedAccount = null;
    }

    getPosition(symbol) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        const pos = this._cachedPositions[canonical];
        if (!pos) return null;
        if (pos.side) return pos;
        return null;
    }

    getAccount() {
        const { usedMargin } = this.getMarginStatus();
        const equity = this.getEquity();
        if (this._cachedAccount) {
            return {
                balance: this._cachedAccount.balance || 0,
                equity,
                currency: this._cachedAccount.currency || this.config?.baseCurrency || "USD",
                usedMargin,
                availableMargin: equity - usedMargin
            };
        }
        return {
            balance: this.cash || 0,
            equity,
            currency: this.config?.baseCurrency || "USD",
            usedMargin,
            availableMargin: equity - usedMargin
        };
    }

    getEquity() {
        return this._cachedEquity;
    }

    getPositionSnapshot(symbol) {
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        const pos = this.getPosition(canonical);
        let unrealized = 0;

        if (pos && this._lastPrice > 0) {
            const side = String(pos.side || "long").toLowerCase();
            unrealized = side === "long"
                ? (this._lastPrice - (pos.entryPrice || pos.openPrice || 0)) * (pos.quantity || pos.volume || 0)
                : ((pos.entryPrice || pos.openPrice || 0) - this._lastPrice) * (pos.quantity || pos.volume || 0);
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
        const lastPrice = Number(bar.close || bar.price || 0);
        if (lastPrice > 0) this._lastPrice = lastPrice;
    }

    async onTick(tick) {
        if (!tick) return;
        const lastPrice = Number(tick.price || tick.bid || 0);
        if (lastPrice > 0) this._lastPrice = lastPrice;
    }

    resetState() {
        this._metrics.init(this.initialCash || 100000);
        this._lastPrice = 0;
        this._cachedEquity = 0;
        this._cachedPositions = {};
        this._cachedAccount = null;
    }

    setCash() {
        // Spec #7: Live mode — broker owns the ledger. Cannot set local cash.
        return false;
    }

    setInitialCash() {
        // Spec #7: Live mode — broker owns the ledger. Cannot set local cash.
        return false;
    }

    updateConfig(next) {
        if (!next || typeof next !== "object") return false;
        this.config = { ...(this.config || {}), ...next };
        this._emitBrokerState({ config: this.config });
        return true;
    }

    resetAccount() {
        // Spec #7: Live mode — broker owns the ledger. Cannot reset local cash.
        return false;
    }

    onFill({ symbol, fillPrice, fillQty, side, commission = 0 }) {
        // Spec #7: Live mode — broker owns the ledger.
        // This push callback updates the cached view of broker state.
        const qty = Number(fillQty);
        const price = Number(fillPrice);
        const posSide = side.toUpperCase() === "BUY" ? "long" : "short";

        if (posSide === "long") {
            this._cachedEquity -= (qty * price + commission);
        } else {
            this._cachedEquity += (qty * price - commission);
        }

        // Update cached position
        const { symbol: canonical } = SymbolNormalizer.normalize(symbol || this.symbol);
        if (posSide === "BUY") {
            this._cachedPositions[canonical] = {
                symbol: canonical,
                side: "long",
                quantity: qty,
                entryPrice: price,
                timestamp: Date.now()
            };
        } else {
            this._cachedPositions[canonical] = {
                symbol: canonical,
                side: "short",
                quantity: qty,
                entryPrice: price,
                timestamp: Date.now()
            };
        }

        this._emitBrokerState({ symbol, side, quantity: qty, cachedEquity: this._cachedEquity });
        this._persist();
        this._emitPortfolioUpdate();
        this._checkMarginGuardrails().catch(() => {});

        try {
            const orderId = `metaapi_order_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const { bus, EVENTS } = require("@events/bus");
            bus.emit(EVENTS.ORDER.FILLED, {
                orderId,
                accountId: this.accountId,
                userId: this.userId,
                environment: this.mode.toUpperCase(),
                symbol: canonical,
                side: side.toUpperCase(),
                quantity: qty,
                price,
                commission: commission || 0,
                orderType: "MARKET",
                status: "FILLED",
                timestamp: Date.now()
            });
        } catch (e) {
            // non-blocking
        }
    }
}

module.exports = MetaApiDriver;
