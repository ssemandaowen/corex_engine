"use strict";

const BaseBroker = require("../base/BaseBroker");
const UnsupportedOperationError = require("../base/UnsupportedOperationError");
const SharedFillSim = require("../utils/SharedFillSim");
const SymbolNormalizer = require("../utils/SymbolNormalizer");
const { bus, EVENTS } = require("@events/bus");

class CoreXPaperDriver extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.supports_trading = true;
        this.supports_streaming_data = true;

        this.initialCash = Number(config.initialCash || config.initialBalance || 10000);
        this.balance = this.initialCash;
        this.trades = [];
        this.positions = new Map();
        this._lastPrice = 0;
        this._marginCallWarned = false;
        this._pendingOrders = [];

        this._fillSim = new SharedFillSim({
            commissionPct: config.commissionPct || config.brokerConfig?.commissionPct || 0,
            slippageBps: config.slippageBps || config.brokerConfig?.slippageBps || 0,
            spread: config.spread || config.brokerConfig?.spread || 0,
            fillPolicy: config.fillPolicy || config.brokerConfig?.fillPolicy || "instant",
            useATR: config.brokerConfig?.useATR || false
        });

        this.dataSource = config.dataSource || null;
    }

    async submit(payload) {
        if (!this._ready) return { status: "REJECTED", reason: "Broker not ready" };

        const { symbol: canonical } = SymbolNormalizer.normalize(payload.Symbol);
        const side = String(payload.Side || "BUY").toUpperCase();
        const quantity = Number(payload.Volume || 0);
        const orderType = String(payload.OrderType || "MARKET").toUpperCase();

        if (!quantity || quantity <= 0) {
            return { status: "REJECTED", reason: "Invalid quantity", orderId: `reject_${Date.now()}` };
        }

        const fillPolicy = String(this.config?.fillPolicy || "instant").toLowerCase();
        if (fillPolicy === "next_bar") {
            return {
                status: "PENDING",
                reason: "Queued for next bar (fillPolicy=next_bar)",
                orderId: `pending_${Date.now()}`,
                avgFillPrice: 0,
                filled: 0,
                remaining: quantity,
                commission: 0,
                timestamp: Date.now(),
                side,
                symbol: canonical,
                raw: { queued: true }
            };
        }

        const bar = { close: this._lastPrice, open: this._lastPrice, time: Date.now() };
        if (this._lastPrice <= 0) {
            return {
                status: "REJECTED",
                reason: "No market data available (price is zero)",
                orderId: `reject_${Date.now()}`,
                avgFillPrice: 0,
                filled: 0,
                remaining: quantity,
                commission: 0,
                timestamp: Date.now(),
                side,
                symbol: canonical,
                raw: {}
            };
        }

        const intent = {
            symbol: canonical,
            side: side === "SELL" ? "short" : "long",
            quantity,
            orderType,
            sl: payload.StopLoss,
            tp: payload.TakeProfit,
            price: payload.Price,
            stopPrice: payload.StopPrice
        };

        const result = this._fillSim.execute(intent, bar);
        if (!result) return { status: "REJECTED", reason: "Fill simulation returned null", orderId: `reject_${Date.now()}` };

        const entryPrice = result.avgFillPrice;
        const posSide = result.side;

        this._settlePosition(canonical, result.filled, entryPrice, posSide, result.commission, payload.StopLoss, payload.TakeProfit, result.timestamp);

        return result;
    }

    _settlePosition(symbol, quantity, price, side, commission, sl, tp, timestamp) {
        const existing = this.positions.get(symbol);
        const isBuy = side === "long";

        if (existing) {
            const closeQty = Math.min(existing.quantity, quantity);
            const exitPrice = price;
            const direction = existing.side === "long" ? 1 : -1;
            const pnl = direction * (exitPrice - existing.entryPrice) * closeQty;

            const remaining = existing.quantity - closeQty;
            if (remaining > 0) {
                existing.quantity = remaining;
            } else {
                this.positions.delete(symbol);
            }

            this.balance += (existing.entryPrice * closeQty) + pnl - commission;
        } else {
            const cost = quantity * price;
            this.balance -= cost + commission;
            this.positions.set(symbol, {
                symbol,
                quantity,
                side: isBuy ? "long" : "short",
                entryPrice: price,
                timestamp: timestamp || Date.now(),
                commissionPaid: commission,
                sl: Number(sl || 0) || 0,
                tp: Number(tp || 0) || 0,
                hwm: price,
                lwm: price,
                pipScale: SymbolNormalizer.normalize(symbol).pipScale
            });
        }

        this._emitPortfolioUpdate();
    }

    async modify(orderId, changes) {
        throw new UnsupportedOperationError("CoreXPaperDriver does not support order modification");
    }

    async cancel(orderId) {
        if (this._pendingOrders.length > 0) {
            const idx = this._pendingOrders.findIndex((o) => o.orderId === orderId);
            if (idx >= 0) {
                const cancelled = this._pendingOrders.splice(idx, 1)[0];
                return { status: "CANCELED", orderId, filled: 0, remaining: cancelled.quantity || 0, timestamp: Date.now() };
            }
        }
        throw new UnsupportedOperationError("CoreXPaperDriver can only cancel pending orders");
    }

    async query_status(orderId) {
        throw new UnsupportedOperationError("CoreXPaperDriver does not support order status queries");
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "PAPER").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 10000);
        this.balance = this.initialCash;
        this._ready = true;

        await this._initDataSource();

        return Promise.resolve();
    }

    /**
     * Wire the per-session dataSource config (set by RuntimeBrokerFactory)
     * to the appropriate market data provider. Currently supports file
     * replay ({ type: "file", path, speed, loop, startOffset }).
     *
     * Uses lazy require to avoid circular dependency
     * (broker-contract -> market-data -> broker-contract for SymbolNormalizer).
     */
    async _initDataSource() {
        if (!this.dataSource) return;

        const ds = this.dataSource;
        const dsType = String(ds.type || "").toLowerCase();

        if (dsType === "file") {
            try {
                const { FileDataProvider } = require("@data/providers/FileDataProvider");
                this._fileProvider = new FileDataProvider(ds);
                await this._fileProvider.connect();
                // Ticks emitted on bus -> MarketFeed -> this driver via onTick
                await this._fileProvider.startReplay({ symbol: this.symbol });
            } catch (err) {
                const logger = require("@utils/logger");
                logger.error(`[CoreXPaperDriver] File data source failed for ${this.symbol}: ${err.message}`);
            }
        } else {
            // Live feed: no action needed, ticks come from TwelveData singleton via bus
        }
    }

    async destroy() {
        this._ready = false;
        this.positions.clear();
        this._pendingOrders = [];
        if (this._fileProvider && typeof this._fileProvider.cleanup === "function") {
            try { await this._fileProvider.cleanup(); } catch { /* best effort */ }
        }
        this._fileProvider = null;
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
        const { usedMargin } = this.getMarginStatus();
        return {
            balance: this.balance,
            equity,
            currency: this.config?.baseCurrency || "USD",
            usedMargin,
            availableMargin: equity - usedMargin
        };
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

    getPerformanceMetrics() {
        const trades = Array.from(this.positions.values()).map(p => ({
            symbol: p.symbol,
            side: p.side,
            quantity: p.quantity,
            entryPrice: p.entryPrice
        }));
        return { trades, finalEquity: this.getEquity() };
    }

    async onBar(bar) {
        if (!bar) return;
        this._lastPrice = Number(bar.close || bar.price || this._lastPrice) || 0;

        if (this._pendingOrders && this._pendingOrders.length && bar.close) {
            const fillPrice = Number(bar.open || bar.close || this._lastPrice) || this._lastPrice;
            const queued = this._pendingOrders.splice(0, this._pendingOrders.length);
            for (const intent of queued) {
                const barForFill = { ...bar, close: fillPrice, time: bar.time || Date.now() };
                await this._executeIntent(intent, barForFill);
            }
        }

        for (const [sym, pos] of this.positions) {
            if (!pos.trailPct || pos.trailPct <= 0) continue;
            const side = pos.side;
            const price = this._lastPrice;

            if (side === "long") {
                pos.hwm = Math.max(Number(pos.hwm || pos.entryPrice), Number(bar.high || price));
                const trailStop = pos.hwm * (1 - pos.trailPct / 100);
                if (Number(bar.low || price) <= trailStop) {
                    await this._settle({ intent: "EXIT", symbol: sym, quantity: pos.quantity }, { ...bar, close: trailStop });
                }
            } else {
                pos.lwm = Math.min(Number(pos.lwm || pos.entryPrice), Number(bar.low || price));
                const trailStop = pos.lwm * (1 + pos.trailPct / 100);
                if (Number(bar.high || price) >= trailStop) {
                    await this._settle({ intent: "EXIT", symbol: sym, quantity: pos.quantity }, { ...bar, close: trailStop });
                }
            }
        }

        await this._checkMarginGuardrails();
    }

    async onTick(tick) {
        if (!tick) return;
        this._lastPrice = Number(tick.price || tick.bid || this._lastPrice) || 0;
        await this._checkMarginGuardrails();
    }

    _executeIntent(intent, marketData) {
        const result = this._fillSim.execute(intent, marketData);
        if (result && result.status === "FILLED") {
            const { symbol: canonical } = SymbolNormalizer.normalize(intent.symbol || this.symbol);
            this._settlePosition(canonical, result.filled, result.avgFillPrice, result.side, result.commission, intent.sl, intent.tp, result.timestamp);
        }
        return result;
    }

    resetState() {
        this.balance = this.initialCash;
        this.trades = [];
        this.positions.clear();
        this._pendingOrders = [];
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

    resetAccount(initialCash) {
        const n = initialCash != null ? Number(initialCash) : this.initialCash || 0;
        this.balance = Number.isFinite(n) ? n : 0;
        this.trades = [];
        this.positions.clear();
        this._pendingOrders = [];
        this._emitBrokerState({ cash: this.balance, initialCash: this.initialCash, config: this.config || {} });
    }

    get commission() {
        if (this._commission !== undefined) return this._commission;
        const pct = this.config?.commissionPct;
        return pct !== undefined ? Number(pct) / 100 : (Number(this.config?.commission) || 0);
    }

    get slippage() {
        if (this._slippage !== undefined) return this._slippage;
        const bps = this.config?.slippageBps;
        return bps !== undefined ? Number(bps) / 10000 : (Number(this.config?.slippage) || 0);
    }

    get spread() {
        if (this._spread !== undefined) return this._spread;
        const bps = this.config?.spreadBps;
        if (bps !== undefined) return (this._lastPrice || 0) * (Number(bps) / 10000);
        if (this.config?.fixedSpread !== undefined) return Number(this.config.fixedSpread) || 0;
        return Number(this.config?.spread) || 0;
    }

    set commission(value) { this._commission = Number(value) || 0; }
    set slippage(value) { this._slippage = Number(value) || 0; }
    set spread(value) { this._spread = Number(value) || 0; }

    async execute(intent, marketData) {
        if (!intent || !marketData) return null;

        const fillPolicy = String(this.config?.fillPolicy || "instant").toLowerCase();
        if (fillPolicy === "next_bar") {
            this._pendingOrders.push({ intent, queuedAt: Date.now() });
            return { status: "PENDING", reason: "Queued for next bar (fillPolicy=next_bar)" };
        }

        const latencyMs = Number(this.config?.executionLatency) || 0;
        if (latencyMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, latencyMs));
        }

        if (intent.intent === "ENTER") {
            const price = marketData.close || marketData.price || this._lastPrice;
            const qty = Number(intent.quantity) || 0;
            if (qty > 0 && !this._checkEntryMargin(qty, price)) {
                return { status: "REJECTED", reason: "INSUFFICIENT_MARGIN" };
            }
        }

        const result = await this._settle(intent, marketData);
        if (result) await this._checkMarginGuardrails();
        return result;
    }

    async _settle(intent, marketData) {
        if (!intent || !marketData) return null;

        const price = marketData.close || marketData.price;
        this._lastPrice = price;
        const symbol = intent.symbol || this.symbol;

        const rawSide = String(intent.side || "long").toLowerCase();
        const side = rawSide === "buy" ? "long" : rawSide === "sell" ? "short" : rawSide;
        const isBuy = side === "long";
        const sideFactor = isBuy ? 1 : -1;

        const slippageOffset = price * (this.slippage || 0);
        const spreadOffset = (this.spread || 0) / 2;
        const executionPrice = price + sideFactor * (slippageOffset + spreadOffset);

        if (intent.intent === "ENTER") {
            const qty = Number(intent.quantity) || 0;
            if (qty <= 0) return null;

            const cost = qty * executionPrice;
            const commissionCost = cost * (this.commission || 0);

            this.balance -= (cost + commissionCost);

            const posRecord = {
                symbol,
                quantity: qty,
                side,
                entryPrice: executionPrice,
                timestamp: marketData.time || Date.now(),
                sl: Number(intent.sl ?? 0) || 0,
                tp: Number(intent.tp ?? 0) || 0,
                trailPct: Number(intent.trailPct ?? 0) || 0,
                hwm: executionPrice,
                lwm: executionPrice,
                commissionPaid: commissionCost,
            };

            this.positions.set(symbol, posRecord);
            this.trades.push({ type: "PAPER_FILL_ENTRY", ...posRecord, commission: commissionCost });
            return posRecord;
        }

        if (intent.intent === "EXIT") {
            const pos = this.positions.get(symbol);
            if (!pos) return null;

            const posSide = String(pos.side || "long").toLowerCase();
            const exitIsBuy = posSide === "long";
            const exitFactor = exitIsBuy ? -1 : 1;
            const exitSlip = price * (this.slippage || 0);
            const exitSpread = (this.spread || 0) / 2;
            const exitPrice = price + exitFactor * (exitSlip + exitSpread);

            const qtyToClose = Number(intent.quantity) || pos.quantity;
            const proceeds = qtyToClose * exitPrice;
            const commissionCost = proceeds * (this.commission || 0);

            const pnl = posSide === "long"
                ? (exitPrice - pos.entryPrice) * qtyToClose
                : (pos.entryPrice - exitPrice) * qtyToClose;

            this.balance += (pos.entryPrice * qtyToClose) + pnl - commissionCost;

            const exitRecord = {
                type: "PAPER_FILL_EXIT",
                symbol,
                quantity: qtyToClose,
                price: exitPrice,
                pnl,
                commission: commissionCost,
                timestamp: marketData.time || Date.now(),
            };

            this.trades.push(exitRecord);
            this.positions.delete(symbol);

            this._metrics.recordTrade({
                entryTime: pos.timestamp,
                exitTime: marketData.time || Date.now(),
                direction: posSide,
                entryPrice: pos.entryPrice,
                exitPrice,
                quantity: qtyToClose,
                profit: pnl - (pos.commissionPaid ?? 0) - commissionCost,
                profitPct: pos.entryPrice > 0
                    ? (pnl / (pos.entryPrice * qtyToClose)) * 100
                    : 0,
                symbol,
                commissionPaid: (pos.commissionPaid ?? 0) + commissionCost,
            });

            bus.emit(EVENTS.STRATEGY.METRICS_TICK, {
                runtimeId: this.runtimeId,
                metrics: this._metrics.getSnapshot(),
                trade: exitRecord,
            });

            return exitRecord;
        }

        return null;
    }

    onFill({ symbol, fillPrice, fillQty, side, commission = 0 }) {
        const qty = Number(fillQty);
        const price = Number(fillPrice);

        if (side.toUpperCase() === "BUY") {
            this.balance -= (qty * price + commission);
        } else {
            this.balance += (qty * price - commission);
        }

        bus.emit(EVENTS.BROKER.STATE_CHANGED, {
            userId: this.userId,
            mode: this.mode,
            payload: { cash: this.balance }
        });
        this._checkMarginGuardrails().catch(() => {});
    }
}

module.exports = CoreXPaperDriver;
