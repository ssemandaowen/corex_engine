"use strict";

const EventEmitter = require('events');
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');
const StrategyPositionManager = require('@utils/strategy/StrategyPositionManager');
const pgStore = require('@core/services/pgStore');
const marketDataBroker = require("@broker/twelvedata");

/**
 * PaperBroker: Virtual Execution Engine
 * The "Control" for Paper Trading state management.
 */
class PaperBroker extends EventEmitter {
    constructor(userIdOrInitialCash = 100000, maybeInitialCash = null) {
        super();

        const treatFirstAsInitialCash = Number.isFinite(Number(userIdOrInitialCash));
        this.userId = treatFirstAsInitialCash
            ? "default"
            : (String(userIdOrInitialCash || "").trim() || "default");

        const seedCash = treatFirstAsInitialCash
            ? Number(userIdOrInitialCash)
            : Number.isFinite(Number(maybeInitialCash))
                ? Number(maybeInitialCash)
                : 100000;

        this.cash = seedCash;
        this.initialCash = seedCash;
        this.positions = new StrategyPositionManager();
        this.lastPrices = new Map();
        this.orderId = 0;
        this._lastPositionEmitAt = new Map(); // symbol -> ts

        this.config = {
            commissionPerShare: 0.005,
            commissionMin: 1.00,
            slippageBps: 5,
            spreadBps: 0,
            fillProbability: 1.0,
            partialFillProbability: 0,
            partialFillMinPct: 0.3,
            partialFillMaxPct: 0.7,
            partialFillCompletionMs: 0,
            latencyMsMin: 0,
            latencyMsMax: 0,
            positionBroadcastMinMs: 250,
            marginRequirement: 1.0, // 1.0 = Cash, <1.0 = Leverage
            maxOrderSize: 1,
            minOrderSize: 0.0001,
            orderStep: 0,
            seed: null,
            stalePriceMaxMs: 120000
        };
        this._persistQueue = Promise.resolve();
        this._lastExecution = null;
        this.orders = new Map(); // orderId -> order
        this.fills = [];
        this._orderSeq = 0;
        this._rngState = null;

        this._applySeed(this.config.seed);
        this._loadSettings().catch(e => logger.error(`[BROKER] Init Error: ${e.message}`));
    }

    // --- SENSORY METRICS ---
    getAccountSnapshot() {
        return {
            mode: "PAPER",
            userId: this.userId,
            cash: this.cash,
            initialCash: this.initialCash,
            config: { ...this.config },
            balance: this.cash,
            equity: this.getEquity(),
            usedMargin: this.getUsedMargin(),
            freeMargin: this.getFreeMargin(),
            positions: this.positions.all().map(p => ({
                ...p,
                markPrice: this._getMarkPrice(p),
                marketValue: this._getPositionMarketValue(p),
                unrealized: p.getPnL(this._getMarkPrice(p))
            })),
            timestamp: Date.now()
        };
    }

    getEquity() {
        let longValue = 0;
        let shortValue = 0;
        for (const pos of this.positions.all()) {
            const value = this._getPositionMarketValue(pos);
            if (String(pos.side).toLowerCase() === 'long') {
                longValue += value;
            } else if (String(pos.side).toLowerCase() === 'short') {
                shortValue += value;
            }
        }
        return this._roundMoney(this.cash + longValue - shortValue);
    }

    getUsedMargin() {
        let used = 0;
        for (const pos of this.positions.all()) {
            const price = this._getMarkPrice(pos);
            used += (Math.abs(pos.quantity) * price) * this.config.marginRequirement;
        }
        return this._roundMoney(used);
    }

    getFreeMargin() {
        return this._roundMoney(this.getEquity() - this.getUsedMargin());
    }

    // --- EXECUTION CORE ---
    execute(symbol, side, quantity, options = {}) {
        const result = this._executeWithResult(symbol, side, quantity, options);
        return result?.ok === true;
    }

    placeOrder(order = {}) {
        const symbol = String(order.symbol || "").trim();
        const side = String(order.side || "").trim().toUpperCase();
        const orderType = String(order.orderType || "MARKET").trim().toUpperCase();
        const intent = String(order.intent || "ENTER").trim().toUpperCase();
        const quantity = Number(order.quantity || 0);
        const strategyId = order.strategyId ? String(order.strategyId) : null;
        const clientOrderId = order.clientOrderId ? String(order.clientOrderId) : null;

        const id = `PPO_${Date.now()}_${++this._orderSeq}`;
        const record = {
            id,
            clientOrderId,
            userId: this.userId,
            strategyId,
            symbol,
            side,
            orderType,
            intent,
            status: "NEW",
            quantity,
            filledQuantity: 0,
            avgFillPrice: 0,
            reason: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            fills: []
        };

        this.orders.set(id, record);
        record.status = "ACCEPTED";
        record.updatedAt = Date.now();

        const qty = this._normalizeQuantity(quantity);
        if (!symbol || !["BUY", "SELL"].includes(side) || !Number.isFinite(qty) || qty <= 0) {
            record.status = "REJECTED";
            record.reason = "INVALID_ORDER";
            record.updatedAt = Date.now();
            return { ok: false, status: "REJECTED", reason: record.reason, order: { ...record } };
        }

        const opts = {
            ...order,
            strategyId,
            orderId: id,
            orderType,
            intent
        };

        const shouldPartial = this._shouldPartialFill();
        if (!shouldPartial) {
            const exec = this._executeWithResult(symbol, side, qty, opts);
            if (!exec.ok) {
                record.status = "REJECTED";
                record.reason = exec.reason || "BROKER_REJECTED";
                record.updatedAt = Date.now();
                return { ok: false, status: record.status, reason: record.reason, order: { ...record }, execution: exec };
            }
            this._applyFillToOrder(record, exec, qty);
            record.status = "FILLED";
            record.updatedAt = Date.now();
            return { ok: true, status: record.status, order: { ...record }, execution: exec };
        }

        const pct = this._samplePartialPct();
        const partialQty = Math.max(this.config.minOrderSize || 0, Number((qty * pct).toFixed(8)));
        const remaining = Number((qty - partialQty).toFixed(8));

        const firstExec = this._executeWithResult(symbol, side, partialQty, opts);
        if (!firstExec.ok) {
            record.status = "REJECTED";
            record.reason = firstExec.reason || "BROKER_REJECTED";
            record.updatedAt = Date.now();
            return { ok: false, status: record.status, reason: record.reason, order: { ...record }, execution: firstExec };
        }
        this._applyFillToOrder(record, firstExec, partialQty);
        record.status = "PARTIAL_FILLED";
        record.updatedAt = Date.now();

        if (remaining > 0) {
            const delay = Math.max(0, Number(this.config.partialFillCompletionMs || 0));
            setTimeout(() => {
                const finalExec = this._executeWithResult(symbol, side, remaining, opts);
                if (finalExec.ok) {
                    this._applyFillToOrder(record, finalExec, remaining);
                    record.status = "FILLED";
                    record.updatedAt = Date.now();
                } else {
                    record.status = "REJECTED";
                    record.reason = finalExec.reason || "BROKER_REJECTED";
                    record.updatedAt = Date.now();
                }
            }, delay);
        }

        return { ok: true, status: record.status, order: { ...record }, execution: firstExec };
    }

    cancelOrder(orderId) {
        const id = String(orderId || "").trim();
        if (!id || !this.orders.has(id)) return { ok: false, status: "NOT_FOUND" };
        const order = this.orders.get(id);
        if (!order) return { ok: false, status: "NOT_FOUND" };
        if (["FILLED", "CANCELLED", "REJECTED"].includes(order.status)) {
            return { ok: false, status: order.status, order: { ...order } };
        }
        order.status = "CANCELLED";
        order.updatedAt = Date.now();
        return { ok: true, status: "CANCELLED", order: { ...order } };
    }

    getOrder(orderId) {
        const id = String(orderId || "").trim();
        if (!id || !this.orders.has(id)) return null;
        return { ...this.orders.get(id) };
    }

    listOrders({ status = null, limit = 200 } = {}) {
        const n = Math.max(1, Math.min(2000, Number(limit || 200)));
        const filter = status ? String(status).trim().toUpperCase() : null;
        const items = Array.from(this.orders.values())
            .filter((o) => (filter ? o.status === filter : true))
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
            .slice(0, n)
            .map((o) => ({ ...o }));
        return items;
    }

    getPositions() {
        return this.positions.all().map((p) => ({ ...p }));
    }

    _executeWithResult(symbol, side, quantity, options = {}) {
        const normalizedSide = String(side || "").toUpperCase();
        if (normalizedSide !== "BUY" && normalizedSide !== "SELL") {
            logger.warn(`[BROKER] INVALID_SIDE: ${symbol} side=${side}`);
            this._lastExecution = {
                ok: false,
                reason: "INVALID_SIDE",
                symbol,
                side: normalizedSide,
                quantity: Number(quantity || 0),
                timestamp: Date.now()
            };
            return this.getLastExecution();
        }

        const qty = this._normalizeQuantity(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            logger.warn(`[BROKER] INVALID_QTY: ${symbol} qty=${quantity}`);
            this._lastExecution = {
                ok: false,
                reason: "INVALID_QTY",
                symbol,
                side: normalizedSide,
                quantity: Number(quantity || 0),
                timestamp: Date.now()
            };
            return this.getLastExecution();
        }

        let price;
        try {
            price = this._getExecutionPrice(symbol, normalizedSide);
        } catch (e) {
            logger.warn(`[BROKER] PRICE_UNAVAILABLE: ${symbol} (${e.message})`);
            this._lastExecution = {
                ok: false,
                reason: "PRICE_UNAVAILABLE",
                symbol,
                side: normalizedSide,
                quantity: qty,
                timestamp: Date.now()
            };
            return this.getLastExecution();
        }

        if (!this._shouldFill()) {
            this._lastExecution = {
                ok: false,
                reason: "LIQUIDITY_REJECTED",
                symbol,
                side: normalizedSide,
                quantity: qty,
                price: this._roundMoney(price),
                timestamp: Date.now()
            };
            return this.getLastExecution();
        }

        const commission = this._calculateCommission(qty);
        const cost = (qty * price);

        const projected = this._projectOrderState(symbol, normalizedSide, qty, price, commission, cost);
        if (projected.projectedFreeMargin < 0) {
            logger.warn(`[BROKER] MARGIN REJECTION: ${symbol} side=${normalizedSide} qty=${qty} free=${projected.projectedFreeMargin.toFixed(2)}`);
            this._lastExecution = {
                ok: false,
                reason: "MARGIN_REJECTION",
                symbol,
                side: normalizedSide,
                quantity: qty,
                price,
                commission,
                timestamp: Date.now()
            };
            return this.getLastExecution();
        }

        // State Update
        this.cash = projected.projectedCash;
        this.positions.applyDelta(symbol, normalizedSide === "BUY" ? qty : -qty, price);
        const deltaMeta = this.positions.getLastDelta?.() || null;
        this._applyRiskControls(symbol, options);
        this._lastExecution = {
            ok: true,
            userId: this.userId,
            symbol,
            side: normalizedSide,
            quantity: qty,
            price: this._roundMoney(price),
            commission: this._roundMoney(commission),
            cost: this._roundMoney(cost),
            realizedPnl: this._roundMoney(Number(deltaMeta?.realizedPnl || 0)),
            sl: Number(options.sl ?? options.stopLoss ?? 0) || 0,
            tp: Number(options.tp ?? options.takeProfit ?? 0) || 0,
            strategyId: options.strategyId ? String(options.strategyId) : null,
            orderId: options.orderId ? String(options.orderId) : null,
            orderType: options.orderType ? String(options.orderType) : "MARKET",
            timestamp: Date.now()
        };

        const latencyMs = this._sampleLatencyMs();
        if (latencyMs > 0) {
            setTimeout(() => {
                this._queuePersist();
                this._broadcastTrade(normalizedSide, symbol, qty, price, commission, options);
            }, latencyMs);
        } else {
            this._queuePersist();
            this._broadcastTrade(normalizedSide, symbol, qty, price, commission, options);
        }
        return this.getLastExecution();
    }

    getLastExecution() {
        return this._lastExecution ? { ...this._lastExecution } : null;
    }

    // --- INTERNAL LOGIC ---
    _getExecutionPrice(symbol, side) {
        let marketPrice = Number(this.lastPrices.get(symbol));
        if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
            const fallback = marketDataBroker.getLastKnownPrice?.(symbol, Number(this.config.stalePriceMaxMs || 120000));
            const fbPrice = Number(fallback?.price || 0);
            if (Number.isFinite(fbPrice) && fbPrice > 0) {
                this.lastPrices.set(symbol, fbPrice);
                marketPrice = fbPrice;
            }
        }
        if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
            throw new Error(`Market data offline: ${symbol}`);
        }
        const spread = 1 + (Number(this.config.spreadBps || 0) / 10000) * (side === "BUY" ? 1 : -1);
        const slip = 1 + (Number(this.config.slippageBps || 0) / 10000) * (side === 'BUY' ? 1 : -1);
        return marketPrice * spread * slip;
    }

    _calculateCommission(qty) {
        return Math.max(this.config.commissionMin, qty * this.config.commissionPerShare);
    }

    _projectOrderState(symbol, side, qty, executionPrice, commission, cost) {
        const projectedCashRaw = side === "BUY"
            ? (this.cash - (cost + commission))
            : (this.cash + (cost - commission));
        const projectedCash = this._roundMoney(projectedCashRaw);

        const projectedPositions = this._clonePositions();
        projectedPositions.applyDelta(symbol, side === "BUY" ? qty : -qty, executionPrice);

        let projectedUsedMargin = 0;
        let projectedLongValue = 0;
        let projectedShortValue = 0;
        for (const pos of projectedPositions.all()) {
            const mark = this._getMarkPrice(pos);
            const value = this._getPositionMarketValue(pos, mark);
            projectedUsedMargin += (Math.abs(pos.quantity) * mark) * this.config.marginRequirement;
            if (String(pos.side).toLowerCase() === 'long') {
                projectedLongValue += value;
            } else if (String(pos.side).toLowerCase() === 'short') {
                projectedShortValue += value;
            }
        }

        const projectedEquity = this._roundMoney(projectedCash + projectedLongValue - projectedShortValue);
        const projectedFreeMargin = this._roundMoney(projectedEquity - projectedUsedMargin);

        return {
            projectedCash,
            projectedEquity,
            projectedUsedMargin: this._roundMoney(projectedUsedMargin),
            projectedFreeMargin
        };
    }

    _clonePositions() {
        const copy = new StrategyPositionManager();
        for (const pos of this.positions.all()) {
            const cloned = copy.open(pos.symbol, pos.side, pos.quantity, pos.avgEntryPrice);
            if (cloned) {
                if (typeof cloned.setLots === "function" && typeof pos.getLots === "function") {
                    cloned.setLots(pos.getLots());
                }
                cloned.stopLoss = pos.stopLoss;
                cloned.takeProfit = pos.takeProfit;
            }
        }
        return copy;
    }

    _getMarkPrice(pos) {
        const fromFeed = Number(this.lastPrices.get(pos.symbol));
        if (Number.isFinite(fromFeed) && fromFeed > 0) return fromFeed;
        const fromEntry = Number(pos?.avgEntryPrice);
        if (Number.isFinite(fromEntry) && fromEntry > 0) return fromEntry;
        return 0;
    }

    _getPositionMarketValue(pos, markPrice = null) {
        const hasExplicitMark = markPrice !== null && markPrice !== undefined;
        const mark = hasExplicitMark ? Number(markPrice) : this._getMarkPrice(pos);
        const qty = Number(pos?.quantity || 0);
        if (!Number.isFinite(mark) || mark <= 0 || !Number.isFinite(qty) || qty <= 0) return 0;
        return this._roundMoney(qty * mark);
    }

    _roundMoney(value, precision = 8) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Number(n.toFixed(precision));
    }

    _shouldFill() {
        const p = Number(this.config.fillProbability);
        if (!Number.isFinite(p)) return true;
        if (p >= 1) return true;
        if (p <= 0) return false;
        return this._rand() <= p;
    }

    _sampleLatencyMs() {
        const min = Math.max(0, Number(this.config.latencyMsMin || 0));
        const max = Math.max(0, Number(this.config.latencyMsMax || 0));
        if (!Number.isFinite(min) && !Number.isFinite(max)) return 0;
        if (max <= 0 && min <= 0) return 0;
        const lo = Math.max(0, Math.min(min, max));
        const hi = Math.max(lo, Math.max(min, max));
        if (hi === 0) return 0;
        return Math.floor(lo + (hi - lo) * this._rand());
    }

    _shouldPartialFill() {
        const p = Number(this.config.partialFillProbability || 0);
        if (!Number.isFinite(p) || p <= 0) return false;
        if (p >= 1) return true;
        return this._rand() <= p;
    }

    _samplePartialPct() {
        let min = Number(this.config.partialFillMinPct || 0.3);
        let max = Number(this.config.partialFillMaxPct || 0.7);
        if (!Number.isFinite(min)) min = 0.3;
        if (!Number.isFinite(max)) max = 0.7;
        min = Math.max(0.05, Math.min(0.95, min));
        max = Math.max(min, Math.min(0.95, max));
        if (max <= min) return min;
        return min + (max - min) * this._rand();
    }

    _applyFillToOrder(order, execution, fillQty) {
        if (!order || !execution) return;
        const qty = Number(fillQty || 0);
        if (!Number.isFinite(qty) || qty <= 0) return;
        const price = Number(execution.price || 0);
        const commission = Number(execution.commission || 0);
        const now = Number(execution.timestamp || Date.now());

        const prevQty = Number(order.filledQuantity || 0);
        const nextQty = Number((prevQty + qty).toFixed(8));
        const prevCost = prevQty * Number(order.avgFillPrice || 0);
        const nextCost = prevCost + (qty * price);
        const avg = nextQty > 0 ? Number((nextCost / nextQty).toFixed(8)) : 0;

        order.filledQuantity = nextQty;
        order.avgFillPrice = avg;
        order.updatedAt = Date.now();

        const fill = {
            id: `PPF_${Date.now()}_${this.fills.length + 1}`,
            orderId: order.id,
            userId: this.userId,
            strategyId: order.strategyId,
            symbol: order.symbol,
            side: order.side,
            quantity: qty,
            price,
            commission,
            timestamp: now
        };
        order.fills = Array.isArray(order.fills) ? order.fills : [];
        order.fills.push(fill);
        this.fills.push(fill);
    }

    _queuePersist() {
        this._persistQueue = this._persistQueue
            .catch(() => {})
            .then(() => this._persist());
        this._persistQueue.catch(e => logger.error(`[BROKER] Persist Fail: ${e.message}`));
        return this._persistQueue;
    }

    _normalizeQuantity(rawQty) {
        let qty = Number(rawQty);
        if (!Number.isFinite(qty) || qty <= 0) return 0;
        const minSize = Number(this.config.minOrderSize || 0);
        const maxSize = Number(this.config.maxOrderSize || 0);
        if (Number.isFinite(maxSize) && maxSize > 0 && qty > maxSize) {
            logger.warn(`[BROKER] Order size capped ${qty} -> ${maxSize}`);
            qty = maxSize;
        }
        if (Number.isFinite(minSize) && minSize > 0 && qty < minSize) {
            logger.warn(`[BROKER] Order size raised ${qty} -> ${minSize}`);
            qty = minSize;
        }
        const step = Number(this.config.orderStep || 0);
        if (Number.isFinite(step) && step > 0) {
            qty = Math.floor(qty / step) * step;
            if (qty < minSize) qty = minSize;
        }
        qty = Number(qty.toFixed(8));
        return qty;
    }

    _applyRiskControls(symbol, options = {}) {
        const pos = this.positions.get(symbol);
        if (!pos) return;
        const sl = Number(options.sl ?? options.stopLoss ?? 0);
        const tp = Number(options.tp ?? options.takeProfit ?? 0);
        if (Number.isFinite(sl) && sl > 0) pos.stopLoss = sl;
        if (Number.isFinite(tp) && tp > 0) pos.takeProfit = tp;
    }

    _isProtectionTriggered(pos, price) {
        if (!pos || !Number.isFinite(Number(price))) return null;
        const px = Number(price);
        const sl = Number(pos.stopLoss);
        const tp = Number(pos.takeProfit);
        const side = String(pos.side || "").toLowerCase();

        if (side === "long") {
            if (Number.isFinite(sl) && sl > 0 && px <= sl) return { type: "SL", trigger: sl };
            if (Number.isFinite(tp) && tp > 0 && px >= tp) return { type: "TP", trigger: tp };
            return null;
        }

        if (side === "short") {
            if (Number.isFinite(sl) && sl > 0 && px >= sl) return { type: "SL", trigger: sl };
            if (Number.isFinite(tp) && tp > 0 && px <= tp) return { type: "TP", trigger: tp };
            return null;
        }

        return null;
    }

    _broadcastTrade(side, symbol, quantity, price, commission, options = {}) {
        const payload = {
            id: `PPR_${Date.now()}`,
            userId: this.userId,
            strategyId: options.strategyId ? String(options.strategyId) : null,
            environment: "PAPER",
            symbol, side, quantity, price, commission,
            orderId: options.orderId ? String(options.orderId) : null,
            orderType: options.orderType ? String(options.orderType) : "MARKET",
            intent: options.intent ? String(options.intent) : null,
            reason: options.reason || null,
            sl: Number(options.sl ?? options.stopLoss ?? 0) || 0,
            tp: Number(options.tp ?? options.takeProfit ?? 0) || 0,
            timestamp: Date.now()
        };
        bus.emit(EVENTS.ORDER.FILLED, payload, { userId: this.userId });
        // Broadcast account/portfolio update on the standardized channel.
        bus.emit(EVENTS.POSITION.PORTFOLIO_UPDATE, { ...this.getAccountSnapshot(), userId: this.userId }, { userId: this.userId });
    }

    async _persist() {
        const runtimePositions = this._serializePositions();
        const payload = {
            cash: this.cash,
            initialCash: this.initialCash,
            config: {
                ...this.config,
                __runtime: {
                    positions: runtimePositions
                }
            }
        };
        if (this.userId && this.userId !== "default") {
            try {
                await pgStore.upsertBrokerSettingsForUser(this.userId, "paper", payload);
            } catch (err) {
                // If user doesn't exist in DB, do not pollute global settings.
                if (err.message.includes("foreign key") || err.message.includes("user_id")) {
                    logger.warn(`[BROKER] User ${this.userId} not found in DB, skipping scoped paper persistence: ${err.message}`);
                } else {
                    throw err;
                }
            }
        } else {
            await pgStore.upsertBrokerSettings("paper", payload);
        }
    }

    async _loadSettings() {
        let data = null;
        if (this.userId && this.userId !== "default") {
            try {
                data = await pgStore.getBrokerSettingsForUser(this.userId, "paper");
            } catch (err) {
                // If user doesn't exist, keep in-memory defaults to avoid cross-user bleed.
                if (err.message.includes("foreign key") || err.message.includes("user_id")) {
                    logger.warn(`[BROKER] User ${this.userId} not found in DB, using in-memory defaults`);
                    data = null;
                } else {
                    throw err;
                }
            }
        } else {
            data = await pgStore.getBrokerSettings("paper");
        }
        
        if (data) {
            const persistedCash = Number(data.cash);
            const persistedInitial = Number(data.initialCash);
            const hasInitial = Number.isFinite(persistedInitial) && persistedInitial > 0;

            // Guardrail: if persisted cash is zero/negative but initial cash is valid,
            // preserve tradability by restoring cash from initial cash.
            if (Number.isFinite(persistedCash) && persistedCash > 0) {
                this.cash = persistedCash;
            } else if (hasInitial) {
                this.cash = persistedInitial;
            }

            if (hasInitial) {
                this.initialCash = persistedInitial;
            } else if (Number.isFinite(this.cash) && this.cash > 0) {
                this.initialCash = this.cash;
            }

            const persistedConfig = data.config && typeof data.config === "object" ? data.config : {};
            const runtime = persistedConfig.__runtime && typeof persistedConfig.__runtime === "object"
                ? persistedConfig.__runtime
                : {};
            const { __runtime, ...settingsConfig } = persistedConfig;
            this.updateConfig(settingsConfig || {}, { persist: false });
            this._restorePositions(runtime.positions);
        }
    }

    updateConfig(next = {}, options = {}) {
        if (!next || typeof next !== "object") return this.config;
        const merged = { ...this.config };
        Object.entries(next).forEach(([k, v]) => {
            if (k === "__runtime") return;
            if (typeof merged[k] === "boolean") {
                merged[k] = v === true || v === "true";
                return;
            }
            if (typeof merged[k] === "number") {
                const n = Number(v);
                if (Number.isFinite(n)) merged[k] = n;
                return;
            }
            merged[k] = v;
        });
        this.config = merged;
        this._applySeed(this.config.seed);
        if (options.persist !== false) this._queuePersist();
        return this.config;
    }

    _applySeed(seed = this.config.seed) {
        if (seed === null || seed === undefined || seed === "") {
            this._rngState = null;
            return;
        }
        let value = seed;
        if (typeof value === "string") {
            let h = 2166136261;
            for (let i = 0; i < value.length; i += 1) {
                h = Math.imul(h ^ value.charCodeAt(i), 16777619);
            }
            value = h >>> 0;
        } else {
            value = Math.floor(Number(value));
        }
        if (!Number.isFinite(value)) {
            this._rngState = null;
            return;
        }
        if (value === 0) value = 1;
        this._rngState = value >>> 0;
    }

    _rand() {
        if (this._rngState === null || this._rngState === undefined) return Math.random();
        let x = this._rngState >>> 0;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this._rngState = x >>> 0;
        return (this._rngState >>> 0) / 4294967296;
    }

    _serializePositions() {
        return this.positions.all().map((pos) => ({
            symbol: pos.symbol,
            side: pos.side,
            quantity: Number(pos.quantity || 0),
            avgEntryPrice: Number(pos.avgEntryPrice || pos.entryPrice || 0),
            stopLoss: Number(pos.stopLoss || 0) || 0,
            takeProfit: Number(pos.takeProfit || 0) || 0,
            lots: typeof pos.getLots === "function" ? pos.getLots() : []
        })).filter((pos) => (
            pos.symbol &&
            (pos.side === "long" || pos.side === "short") &&
            Number.isFinite(pos.quantity) &&
            pos.quantity > 0 &&
            Number.isFinite(pos.avgEntryPrice) &&
            pos.avgEntryPrice > 0
        ));
    }

    _restorePositions(rawPositions) {
        if (!Array.isArray(rawPositions)) return;
        this.positions = new StrategyPositionManager();
        rawPositions.forEach((raw) => {
            const symbol = String(raw?.symbol || "").trim();
            const side = String(raw?.side || "").toLowerCase();
            const quantity = Number(raw?.quantity || 0);
            const entry = Number(raw?.avgEntryPrice || 0);
            if (!symbol || !["long", "short"].includes(side)) return;
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            if (!Number.isFinite(entry) || entry <= 0) return;
            const pos = this.positions.open(symbol, side, quantity, entry);
            if (!pos) return;
            if (Array.isArray(raw?.lots) && typeof pos.setLots === "function") {
                pos.setLots(raw.lots);
            }
            const sl = Number(raw?.stopLoss || 0);
            const tp = Number(raw?.takeProfit || 0);
            if (Number.isFinite(sl) && sl > 0) pos.stopLoss = sl;
            if (Number.isFinite(tp) && tp > 0) pos.takeProfit = tp;
        });
    }

    setCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.cash = n;
        this._queuePersist();
        return true;
    }

    setInitialCash(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return false;
        this.initialCash = n;
        this._queuePersist();
        return true;
    }

    resetAccount(initialCash = null) {
        const seed = Number(initialCash);
        if (Number.isFinite(seed) && seed > 0) {
            this.initialCash = seed;
        }
        this.cash = this.initialCash;
        this.positions = new StrategyPositionManager();
        this._queuePersist();
        return this.getAccountSnapshot();
    }

    updatePrice(symbol, price) {
        const px = Number(price);
        if (Number.isFinite(px) && px > 0) {
            this.lastPrices.set(symbol, px);
        }
        const pos = this.positions.get(symbol);
        const protection = this._isProtectionTriggered(pos, px);
        if (pos && protection) {
            const closeSide = String(pos.side || "").toLowerCase() === "short" ? "BUY" : "SELL";
            const qty = Number(pos.quantity || 0);
            if (qty > 0) {
                const ok = this.execute(symbol, closeSide, qty, { reason: protection.type });
                if (ok) {
                    logger.info(`[BROKER] ${protection.type}_TRIGGERED: ${symbol} @ ${px}`);
                    return;
                }
            }
        }

        // Only broadcast if position exists to save bandwidth
        if (this.positions.get(symbol)) {
            const now = Date.now();
            const minMs = Math.max(0, Number(this.config.positionBroadcastMinMs || 0));
            const lastAt = Number(this._lastPositionEmitAt.get(symbol) || 0);
            if ((now - lastAt) >= minMs) {
                this._lastPositionEmitAt.set(symbol, now);
                bus.emit(EVENTS.POSITION.UPDATED, { ...this.getAccountSnapshot(), userId: this.userId, symbol }, { userId: this.userId });
            }
        }
    }
}

module.exports = PaperBroker;
