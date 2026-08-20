"use strict";

const BaseBroker = require("../base/BaseBroker");
const { bus, EVENTS } = require("@events/bus");
const { MetricsAccumulator } = require("@utils/metrics");

class PaperBroker extends BaseBroker {
    constructor(config = {}) {
        super(config);

        this.balance = config.initialBalance || 10000;
        this.userId = config.userId || "system";
        this.trades = [];
        this.positions = new Map();

        this._metrics = new MetricsAccumulator();
        this._metrics.init(config.initialCash || config.initialBalance || 10000);

        this._lastPrice = 0;
        this._marginCallWarned = false;
        // Orders queued when config.fillPolicy === "next_bar"; drained on the next onBar().
        this._pendingOrders = [];
    }

    // ── Friction constants, read live off this.config so PATCH /settings ──
    // (broker.updateConfig()) takes effect immediately, not just at construction.
    get commission() {
        const pct = this.config?.commissionPct;
        return pct !== undefined ? Number(pct) / 100 : (Number(this.config?.commission) || 0);
    }

    get slippage() {
        const bps = this.config?.slippageBps;
        return bps !== undefined ? Number(bps) / 10000 : (Number(this.config?.slippage) || 0);
    }

    get spread() {
        // Prefer bps (relative), fall back to an absolute fixedSpread, then legacy `spread`.
        const bps = this.config?.spreadBps;
        if (bps !== undefined) return (this._lastPrice || 0) * (Number(bps) / 10000);
        if (this.config?.fixedSpread !== undefined) return Number(this.config.fixedSpread) || 0;
        return Number(this.config?.spread) || 0;
    }

    async initialize(config) {
        this.mode = String(config.mode || this.mode || "PAPER").toUpperCase();
        this.runtimeId = config.runtimeId || this.runtimeId;
        this.initialCash = Number(config.initialCash || this.initialCash || 10000);
        this.cash = this.initialCash;
        this.balance = this.initialCash;
        this._metrics = new MetricsAccumulator();
        this._metrics.init(this.initialCash);
        this._ready = true;
        return Promise.resolve();
    }

    resetState() {
        this.balance = this.initialCash;
        this.cash = this.initialCash;
        this.trades = [];
        this.positions = new Map();
        this._metrics.init(this.initialCash);
        this._lastPrice = 0;
        this._emitBrokerState({ cash: this.balance, initialCash: this.initialCash, config: this.config || {} });
    }

    async destroy() {
        this._ready = false;
        this.positions.clear();
        this.trades = [];
        if (this._metrics) this._metrics.reset();
    }

    getPosition(symbol) {
        const target = symbol || this.symbol;
        const pos = this.positions.get(target);
        if (!pos) return null;
        return {
            symbol: target,
            side: pos.side,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            unrealizedPnL: this._computeUnrealized(pos)
        };
    }

    _computeUnrealized(pos) {
        if (!pos || !this._lastPrice) return 0;
        const side = pos.side;
        const qty = pos.quantity;
        if (side === "long" || side === "buy") {
            return (this._lastPrice - pos.entryPrice) * qty;
        }
        return (pos.entryPrice - this._lastPrice) * qty;
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

    getPerformanceMetrics() {
        return this._metrics.getSnapshot();
    }

    async onBar(bar) {
        if (!bar) return;
        this._lastPrice = Number(bar.close || bar.price || this._lastPrice) || 0;

        // ── Drain orders queued while fillPolicy === "next_bar" ────────────────
        // Fill at this bar's open (falls back to close if open is missing).
        if (this._pendingOrders.length) {
            const fillPrice = Number(bar.open ?? bar.close ?? this._lastPrice) || this._lastPrice;
            const queued = this._pendingOrders.splice(0, this._pendingOrders.length);
            for (const { intent } of queued) {
                await this._settle(intent, { ...bar, close: fillPrice, time: bar.time ?? Date.now() });
            }
        }

        // ── Trailing stop check ───────────────────────────────────────────────
        // Iterate all open positions and auto-close any that hit their trail level.
        for (const [sym, pos] of this.positions) {
            if (!pos.trailPct || pos.trailPct <= 0) continue;
            const side = String(pos.side || "long").toLowerCase();
            const price = this._lastPrice;

            if (side === "long") {
                pos.hwm = Math.max(Number(pos.hwm ?? pos.entryPrice), Number(bar.high || price));
                const trailStop = pos.hwm * (1 - pos.trailPct / 100);
                if (Number(bar.low || price) <= trailStop) {
                    await this._settle({ intent: "EXIT", symbol: sym, quantity: pos.quantity }, { ...bar, close: trailStop });
                }
            } else {
                pos.lwm = Math.min(Number(pos.lwm ?? pos.entryPrice), Number(bar.low || price));
                const trailStop = pos.lwm * (1 + pos.trailPct / 100);
                if (Number(bar.high || price) >= trailStop) {
                    await this._settle({ intent: "EXIT", symbol: sym, quantity: pos.quantity }, { ...bar, close: trailStop });
                }
            }
        }

        // ── Margin call / stop-out check ────────────────────────────────────
        await this._checkMarginGuardrails();
    }

    async onTick(tick) {
        if (!tick) return;
        this._lastPrice = Number(tick.price || tick.bid || this._lastPrice) || 0;
        await this._checkMarginGuardrails();
    }

    async placeOrder(signal) {
        if (!this._ready) return { status: "ERROR", reason: "Broker not ready" };
        const result = await this.execute({ ...signal, intent: "ENTER" }, { close: this._lastPrice, time: Date.now() });
        return result || { status: "REJECTED", reason: "No execution result" };
    }

    async closePosition(signal) {
        if (!this._ready) return { status: "ERROR", reason: "Broker not ready" };
        const result = await this.execute({ ...signal, intent: "EXIT" }, { close: this._lastPrice, time: Date.now() });
        return result || { status: "REJECTED", reason: "No execution result" };
    }

    /**
     * Public entry point for externally-triggered orders (placeOrder/closePosition).
     * Honors config.fillPolicy ("instant" default, or "next_bar" to queue until
     * the next onBar()) and config.executionLatency (ms delay before an instant
     * fill is settled). Internal callers (trailing stop, margin guardrails) call
     * _settle() directly since those are already bar-driven.
     */
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

        // Normalise side to canonical lowercase ("long"/"short")
        const rawSide = String(intent.side || "long").toLowerCase();
        const side = rawSide === "buy" ? "long" : rawSide === "sell" ? "short" : rawSide;
        const isBuy = side === "long";
        const sideFactor = isBuy ? 1 : -1;

        // Slippage = % of price, spread = absolute half-spread
        const slippageOffset = price * (this.slippage || 0);
        const spreadOffset   = (this.spread || 0) / 2;
        const executionPrice = price + sideFactor * (slippageOffset + spreadOffset);

        if (intent.intent === "ENTER") {
            const qty = Number(intent.quantity) || 0;
            if (qty <= 0) return null;

            const cost           = qty * executionPrice;
            const commissionCost = cost * (this.commission || 0);

            this.balance -= (cost + commissionCost);

            const posRecord = {
                symbol,
                quantity:      qty,
                side,
                entryPrice:    executionPrice,
                timestamp:     marketData.time || Date.now(),
                // SL / TP / trail from signal
                sl:        Number(intent.sl      ?? 0) || 0,
                tp:        Number(intent.tp      ?? 0) || 0,
                trailPct:  Number(intent.trailPct ?? 0) || 0,
                hwm:       executionPrice,
                lwm:       executionPrice,
                commissionPaid: commissionCost,
            };

            this.positions.set(symbol, posRecord);
            this.trades.push({ type: "PAPER_FILL_ENTRY", ...posRecord, commission: commissionCost });
            return posRecord;
        }

        if (intent.intent === "EXIT") {
            const pos = this.positions.get(symbol);
            if (!pos) return null;

            const posSide      = String(pos.side || "long").toLowerCase();
            const exitIsBuy    = posSide === "long";
            const exitFactor   = exitIsBuy ? -1 : 1;           // exit is opposite side
            const exitSlip     = price * (this.slippage || 0);
            const exitSpread   = (this.spread || 0) / 2;
            const exitPrice    = price + exitFactor * (exitSlip + exitSpread);

            const qtyToClose   = Number(intent.quantity) || pos.quantity;
            const proceeds     = qtyToClose * exitPrice;
            const commissionCost = proceeds * (this.commission || 0);

            const pnl = posSide === "long"
                ? (exitPrice - pos.entryPrice) * qtyToClose
                : (pos.entryPrice - exitPrice) * qtyToClose;

            this.balance += (pos.entryPrice * qtyToClose) + pnl - commissionCost;

            const exitRecord = {
                type:      "PAPER_FILL_EXIT",
                symbol,
                quantity:  qtyToClose,
                price:     exitPrice,
                pnl,
                commission: commissionCost,
                timestamp: marketData.time || Date.now(),
            };

            this.trades.push(exitRecord);
            this.positions.delete(symbol);

            this._metrics.recordTrade({
                entryTime:     pos.timestamp,
                exitTime:      marketData.time || Date.now(),
                direction:     posSide,
                entryPrice:    pos.entryPrice,
                exitPrice,
                quantity:      qtyToClose,
                profit:        pnl - (pos.commissionPaid ?? 0) - commissionCost,
                profitPct:     pos.entryPrice > 0
                    ? (pnl / (pos.entryPrice * qtyToClose)) * 100
                    : 0,
                symbol,
                commissionPaid: (pos.commissionPaid ?? 0) + commissionCost,
            });

            bus.emit(EVENTS.STRATEGY.METRICS_TICK, {
                runtimeId: this.runtimeId,
                metrics:   this._metrics.getSnapshot(),
                trade:     exitRecord,
            });

            return exitRecord;
        }

        return null;
    }

    getPositionSnapshot(symbol) {
        const targetSymbol = symbol || this.symbol;
        const record = this.positions.get(targetSymbol);
        let unrealized = 0;

        if (record && this._lastPrice > 0) {
            const side = String(record.side || "long").toLowerCase();
            unrealized = (side === "long")
                ? (this._lastPrice - record.entryPrice) * record.quantity
                : (record.entryPrice - this._lastPrice) * record.quantity;
        }

        return Object.freeze({
            positions: record ? { [targetSymbol]: { ...record, unrealizedPnl: unrealized } } : {},
            openCount:      this.positions.size,
            totalUnrealized: unrealized,
        });
    }

    getEquity() {
        const snapshot = this.getPositionSnapshot();
        return this.balance + snapshot.totalUnrealized;
    }

    /**
     * MUTABLE OPERATIONS THAT TRIGGER EVENT-DRIVEN PERSISTENCE
     * ===========================================================
     * 
     * Each of these methods updates broker state and emits an event
     * that triggers automatic persistence to the database.
     * 
     * The flow is:
     * 1. Method updates internal state (this.cash, this.config, etc.)
     * 2. Method calls this._emitBrokerState({ fieldName: newValue })
     * 3. Event fired: EVENTS.BROKER.STATE_CHANGED
     * 4. brokerPersistence service listener catches event
     * 5. brokerPersistence calls pgStore to update database
     * 
     * No explicit database calls needed — the broker modules handle it.
     */

    /**
     * SET CASH BALANCE
     * 
     * Updates available cash for trading.
     * 
     * Emits: EVENTS.BROKER.STATE_CHANGED with { cash: newValue }
     * 
     * @param {number} value - New cash balance
     * @returns {boolean} - true if successful, false if invalid input
     * 
     * Example:
     *   const ok = broker.setCash(50000);
     *   // Event emitted → database updated automatically
     */
    setCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.cash = n;
        this._emitBrokerState({ cash: this.cash });  // Triggers persistence
        return true;
    }

    /**
     * SET INITIAL CASH (Starting Balance)
     * 
     * Updates the initial balance reference point.
     * 
     * Emits: EVENTS.BROKER.STATE_CHANGED with { initialCash: newValue }
     * 
     * @param {number} value - New initial cash balance
     * @returns {boolean} - true if successful, false if invalid input
     * 
     * Example:
     *   const ok = broker.setInitialCash(100000);
     *   // Event emitted → database updated automatically
     */
    setInitialCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.initialCash = n;
        this._emitBrokerState({ initialCash: this.initialCash });  // Triggers persistence
        return true;
    }

    /**
     * UPDATE BROKER CONFIGURATION
     * 
     * Merges new config values with existing broker configuration.
     * 
     * Emits: EVENTS.BROKER.STATE_CHANGED with { config: newConfig }
     * 
     * @param {Object} next - Configuration object to merge
     * @returns {boolean} - true if successful, false if invalid input
     * 
     * Example:
     *   const ok = broker.updateConfig({ commission: 0.001, slippage: 2 });
     *   // Event emitted → database updated automatically
     */
    updateConfig(next) {
        if (!next || typeof next !== "object") return false;
        this.config = { ...(this.config || {}), ...next };
        this._emitBrokerState({ config: this.config });  // Triggers persistence
        return true;
    }

    /**
     * RESET ACCOUNT TO INITIAL STATE
     * 
     * Clears all trades and positions; resets cash to initial balance.
     * This is commonly used for:
     * - Starting a new backtest/paper trading session
     * - Clearing previous failed trades
     * - Control commands from UI
     * 
     * Emits: EVENTS.BROKER.STATE_CHANGED with full account state
     * 
     * @param {number} [initialCash] - Optional new initial cash (if not provided, uses current this.initialCash)
     * 
     * Example:
     *   broker.resetAccount(100000);  // Reset with new starting balance
     *   // Event emitted → database updated automatically
     */
    resetAccount(initialCash) {
        const n = initialCash != null ? Number(initialCash) : this.initialCash || 0;
        this.balance = Number.isFinite(n) ? n : 0;
        this.trades = [];
        this.positions = new Map();
        this._emitBrokerState({ cash: this.balance, initialCash: this.initialCash, config: this.config || {} });  // Triggers persistence
    }
}

module.exports = PaperBroker;