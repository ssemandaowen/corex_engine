"use strict";

const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");
const db = require("@core/services/postgres");
const { getPaperBroker } = require("@broker/paperStore");
const mt5Bridge = require("@core/services/mt5Bridge");
const { parseScopedId } = require("@core/services/userScope");
const envTrue = (v) => ["1", "true", "yes", "on"].includes(String(v || "").trim().toLowerCase());

class SignalAdapter {
    /**
     * @param {string} mode - BACKTEST | PAPER | LIVE
     * @param {Object} broker - The active broker instance (PaperBroker or MT5Bridge)
     */
    constructor({ mode = "PAPER", broker = null, brokers = null } = {}) {
        this.mode = this._normalizeMode(mode);
        this.broker = broker;
        this.brokers = brokers || {};
        this.btContext = null;

        // Hot-path guard: avoid a DB hit per-signal for runtime_mode lookups.
        // Strategy runtime mode changes are relatively infrequent, so a short TTL cache is safe.
        this._modeCache = new Map(); // strategyId -> { mode, loadedAt }
        this._modeCacheTtlMs = Math.max(250, Number(process.env.SIGNAL_MODE_CACHE_TTL_MS || 2000));
        
        // Internal state to prevent signal collision
        this.processing = new Set();
        this.metrics = {
            handled: 0,
            rejected: 0,
            locked: 0,
            failed: 0,
            latencyMsTotal: 0,
            lastLatencyMs: 0,
            lastHandledAt: 0,
            lastFailureAt: 0
        };
        this._recentEvents = [];
        this._recentLimit = 200;
        
        logger.info(`[ARCH] SignalAdapter standardized for mode: ${this.mode}`);
    }

    /**
     * Binds Grademark context for backtesting
     */
    bindBacktestContext(context) {
        if (this.mode === "BACKTEST") this.btContext = context;
    }

    /**
     * THE GATEKEEPER: All signals from any strategy pass through here.
     */
    async handle(signal) {
        const startTs = Date.now();
        this.metrics.handled += 1;
        const normalized = this._normalizeSignal(signal);
        const traceId = this._newTraceId(normalized);
        if (!this._isValid(normalized)) {
            this.metrics.rejected += 1;
            this._recordHandleComplete(startTs);
            this._recordEvent("REJECTED", {
                traceId,
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                reason: "INVALID_SCHEMA"
            });
            return { status: 'REJECTED', reason: 'INVALID_SCHEMA', traceId };
        }

        const mode = await this._resolveMode(normalized.strategyId);
        const lockKey = `${normalized.strategyId}_${normalized.symbol}`;
        if (this.processing.has(lockKey)) {
            logger.warn(`[ADAPTER] Signal locked: ${lockKey} is already awaiting execution.`);
            this.metrics.locked += 1;
            this._recordHandleComplete(startTs);
            this._recordEvent("LOCKED", {
                traceId,
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                mode
            });
            return { status: 'LOCKED', traceId };
        }

        this.processing.add(lockKey);

        const userId = this._extractScopedUserId(normalized.strategyId, normalized);
        
        bus.emit(EVENTS.STRATEGY.SIGNAL, {
            strategyId: normalized.strategyId,
            symbol: normalized.symbol,
            intent: normalized.intent,
            side: normalized.side,
            quantity: normalized.quantity,
            mode,
            traceId,
            ts: Date.now()
        }, {
            ts: Date.now(),
            userId,
            strategyId: normalized.strategyId,
            symbol: normalized.symbol,
            correlationId: traceId
        });

        try {
            let result;
            switch (mode) {
                case "BACKTEST":
                    result = this._execBacktest(normalized);
                    break;
                case "PAPER":
                    result = this._execPaper(normalized, this._getBroker("PAPER", normalized.strategyId));
                    break;
                case "LIVE":
                    result = await this._execLive(normalized);
                    break;
                default:
                    result = this._execPaper(normalized, this._getBroker("PAPER", normalized.strategyId));
                    break;
            }
            const finalResult = result || { status: "REJECTED", reason: "NO_RESULT" };
            this._recordHandleComplete(startTs);
            this._recordEvent("RESULT", {
                traceId,
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                mode,
                status: finalResult?.status || (finalResult?.ok ? "OK" : "UNKNOWN"),
                reason: finalResult?.reason || null
            });
            return { traceId, ...finalResult };
        } catch (err) {
            this.metrics.failed += 1;
            this.metrics.lastFailureAt = Date.now();
            logger.error(`[ADAPTER] Handle failed (${mode}) for ${normalized.strategyId}: ${err.message}`);
            if (err?.stack) logger.error(`[ADAPTER] Stack (${mode}) ${err.stack}`);
            bus.emit(EVENTS.SYSTEM.ERROR, {
                source: "signal_adapter",
                traceId,
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                message: err.message,
                at: new Date().toISOString()
            }, {
                ts: Date.now(),
                userId,
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                correlationId: traceId
            });
            this._recordHandleComplete(startTs);
            this._recordEvent("ERROR", {
                traceId,
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                mode,
                reason: err.message
            });
            return { status: "ERROR", reason: err.message, traceId };
        } finally {
            this.processing.delete(lockKey);
        }
    }

    /**
     * Synchronous handler for backtests (no async, no locks).
     */
    handleSync(signal) {
        const normalized = this._normalizeSignal(signal);
        if (!this._isValid(normalized)) return { status: 'REJECTED', reason: 'INVALID_SCHEMA' };
        if (this.mode !== "BACKTEST") return { status: 'REJECTED', reason: 'SYNC_ONLY_BACKTEST' };
        return this._execBacktest(normalized);
    }

    _isValid(s) {
        const required = ['strategyId', 'symbol', 'intent'];
        if (!required.every(field => s && s[field])) return false;
        if (!["ENTER", "EXIT"].includes(String(s.intent).toUpperCase())) return false;
        if (!Number.isFinite(Number(s.quantity)) || Number(s.quantity) < 0) return false;
        return true;
    }

    _normalizeMode(mode) {
        const normalized = String(mode || "PAPER").toUpperCase();
        if (["BACKTEST", "PAPER", "LIVE"].includes(normalized)) return normalized;
        return "PAPER";
    }

    _normalizeSignal(signal = {}) {
        const normalizedIntent = this._normalizeIntent(signal.intent || signal.action || signal.type);
        const normalizedSide = this._normalizeSide(signal.side || signal.direction || signal.orderSide);
        const qty = Number(signal.quantity ?? signal.qty ?? 0);
        return {
            ...signal,
            strategyId: String(signal.strategyId || "").trim(),
            symbol: String(signal.symbol || "").trim(),
            intent: normalizedIntent,
            side: normalizedSide,
            quantity: Number.isFinite(qty) ? Math.abs(qty) : 0
        };
    }

    _normalizeIntent(rawIntent) {
        const intent = String(rawIntent || "").trim().toUpperCase();
        if (["EXIT", "CLOSE", "FLAT"].includes(intent)) return "EXIT";
        if (["ENTER", "OPEN", "BUY", "SELL", "LONG", "SHORT"].includes(intent)) return "ENTER";
        return intent;
    }

    _normalizeSide(rawSide) {
        const side = String(rawSide || "").trim().toLowerCase();
        if (["buy", "long"].includes(side)) return "long";
        if (["sell", "short"].includes(side)) return "short";
        if (["flat", "close", "exit"].includes(side)) return "flat";
        return "flat";
    }

    _extractScopedUserId(strategyId, signal = null) {
        const parsed = parseScopedId(strategyId || "");
        const scopedUid = String(parsed?.userId || "").trim();
        if (scopedUid) return scopedUid;

        const directUid = String(
            signal?.userId ||
            signal?.meta?.userId ||
            signal?.context?.userId ||
            ""
        ).trim();
        return directUid || null;
    }

    getMetrics() {
        const handled = Number(this.metrics.handled || 0);
        const avgLatencyMs = handled > 0 ? (this.metrics.latencyMsTotal / handled) : 0;
        return {
            ...this.metrics,
            avgLatencyMs: Number(avgLatencyMs.toFixed(3)),
            inflightLocks: this.processing.size
        };
    }

    getRecentEvents(limit = 40) {
        const n = Math.max(1, Math.min(200, Number(limit || 40)));
        return this._recentEvents.slice(-n);
    }

    _newTraceId(signal = {}) {
        const strategy = String(signal?.strategyId || "na").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) || "na";
        const symbol = String(signal?.symbol || "na").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "na";
        return `sig_${strategy}_${symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    _recordHandleComplete(startTs) {
        const now = Date.now();
        const latency = Math.max(0, now - Number(startTs || now));
        this.metrics.lastLatencyMs = latency;
        this.metrics.lastHandledAt = now;
        this.metrics.latencyMsTotal += latency;
    }

    _recordEvent(type, payload = {}) {
        const event = {
            type: String(type || "UNKNOWN"),
            at: Date.now(),
            payload: payload && typeof payload === "object" ? payload : {}
        };
        this._recentEvents.push(event);
        if (this._recentEvents.length > this._recentLimit) {
            this._recentEvents.splice(0, this._recentEvents.length - this._recentLimit);
        }
    }

    // --- Execution Logic Blocks ---

    _execBacktest(s) {
        if (!this.btContext) return { status: "REJECTED", reason: "BACKTEST_CONTEXT_MISSING" };
        if (s.intent === "ENTER") {
            return this.btContext.enter({ direction: s.side });
        }
        return this.btContext.exit();
    }

    _execPaper(s, broker) {
        if (!broker) return { status: "REJECTED", reason: "BROKER_UNAVAILABLE" };
        const stops = this._extractStops(s);
        const paperSide = s.intent === "ENTER"
            ? this._paperOrderSide(s)
            : (s.side === "short" ? "BUY" : "SELL");
        const orderType = s.intent === "ENTER" ? "MARKET" : "CLOSE";

        let brokerResult;
        if (s.intent === "ENTER") {
            brokerResult = this._paperOpenPosition(s, broker, stops);
        } else {
            brokerResult = this._paperClosePosition(s, broker);
        }

        const normalizedExec = this._normalizePaperExecutionResult(broker, {
            strategyId: s.strategyId,
            symbol: s.symbol,
            side: paperSide,
            quantity: s.quantity,
            sl: stops.sl,
            tp: stops.tp,
            orderType
        }, brokerResult);

        if (!normalizedExec.ok) {
            return { status: "REJECTED", reason: normalizedExec.reason || "EXECUTION_REJECTED" };
        }

        this._persistPaperFill(normalizedExec).catch(() => {});
        return {
            ok: true,
            status: "FILLED",
            environment: "PAPER",
            ...normalizedExec
        };
    }

    _paperOrderSide(s) {
        return s?.side === "short" ? "SELL" : "BUY";
    }

    _paperOpenPosition(s, broker, stops = {}) {
        const side = this._paperOrderSide(s);
        const qty = Number(s?.quantity || 0) || 0;
        if (s?.side === "flat") return { status: "REJECTED", reason: "INVALID_SIDE_FOR_ENTER" };
        if (qty <= 0) return { status: "REJECTED", reason: "INVALID_QTY" };

        if (typeof broker.placeOrder === "function") {
            return broker.placeOrder({
                symbol: s.symbol,
                side,
                quantity: qty,
                orderType: "MARKET",
                intent: "ENTER",
                strategyId: s.strategyId,
                params: s.meta,
                ...stops
            });
        }
        if (typeof broker.execute === "function") {
            return broker.execute(s.symbol, side, qty, { ...stops, strategyId: s.strategyId });
        }
        if (typeof broker.openPosition === "function") {
            return broker.openPosition({
                symbol: s.symbol,
                side,
                quantity: qty,
                strategyId: s.strategyId,
                params: s.meta,
                ...stops
            });
        }
        if (typeof broker.buy === "function" || typeof broker.sell === "function") {
            return side === "BUY"
                ? broker.buy?.(s.symbol, qty)
                : broker.sell?.(s.symbol, qty);
        }
        throw new Error("Paper broker does not implement execute/openPosition/buy-sell API");
    }

    _paperClosePosition(s, broker) {
        if (typeof broker.placeOrder === "function") {
            let qty = Number(s?.quantity || 0) || 0;
            let closeSide = null;
            const existing = broker?.positions?.get?.(s.symbol);
            if (existing && Number(existing.quantity) > 0) {
                qty = Number(existing.quantity);
                closeSide = String(existing.side || "").toLowerCase() === "short" ? "BUY" : "SELL";
            }
            if (!closeSide) {
                if (s?.side === "long") closeSide = "SELL";
                if (s?.side === "short") closeSide = "BUY";
            }
            if (!closeSide) return { status: "REJECTED", reason: "AMBIGUOUS_EXIT_SIDE" };
            if (!Number.isFinite(qty) || qty <= 0) return { status: "REJECTED", reason: "NO_OPEN_POSITION" };
            return broker.placeOrder({
                symbol: s.symbol,
                side: closeSide,

                quantity: qty,
                orderType: "CLOSE",
                intent: "EXIT",
                strategyId: s.strategyId,
                params: s.meta
            });
        }
        if (typeof broker.closePosition === "function") {
            return broker.closePosition(s.symbol);
        }
        if (typeof broker.execute === "function") {
            const existing = broker?.positions?.get?.(s.symbol);
            if (existing && Number(existing.quantity) > 0) {
                const qty = Number(existing.quantity);
                const closeSide = String(existing.side || "").toLowerCase() === "short" ? "BUY" : "SELL";
                return broker.execute(s.symbol, closeSide, qty, { strategyId: s.strategyId });
            }
            const fallbackQty = Number(s?.quantity || 0) || 0;
            if (fallbackQty <= 0) return { status: "REJECTED", reason: "NO_OPEN_POSITION" };
            if (s?.side === "long") return broker.execute(s.symbol, "SELL", fallbackQty, { strategyId: s.strategyId });
            if (s?.side === "short") return broker.execute(s.symbol, "BUY", fallbackQty, { strategyId: s.strategyId });
            return { status: "REJECTED", reason: "AMBIGUOUS_EXIT_SIDE" };
        }
        return { status: "REJECTED", reason: "BROKER_CLOSE_NOT_SUPPORTED" };
    }

    async _execLive(s) {
        if (!db.hasDbConfig()) return { status: "REJECTED", reason: "DB_NOT_CONFIGURED" };
        const stops = this._extractStops(s);
        const terminalId = String(s.terminalId || s.meta?.terminalId || s.meta?.terminal_id || "").trim() || null;
        if (envTrue(process.env.COREX_LIVE_DRY_RUN)) {
            logger.warn(`[ADAPTER] LIVE dry-run: ${s.intent} ${s.symbol} ${s.quantity} (${s.strategyId})`);
            return {
                ok: true,
                dryRun: true,
                action: s.intent === "ENTER" ? "openPosition" : "closePosition",
                payload: {
                    symbol: s.symbol,
                    side: s.side,
                    volume: s.quantity,
                    sl: stops.sl,
                    tp: stops.tp,
                    params: s.meta,
                    terminalId,
                    strategyId: s.strategyId
                }
            };
        }

        const side = s.intent === "EXIT"
            ? (s.side === "short" ? "BUY" : s.side === "long" ? "SELL" : null)
            : (s.side === "short" ? "SELL" : s.side === "long" ? "BUY" : null);
        if (!side) return { status: "REJECTED", reason: "AMBIGUOUS_SIDE" };
        const orderType = s.intent === "ENTER" ? "MARKET" : "CLOSE";
        const orderId = await this._insertLiveOrder({
            strategyId: s.strategyId,
            symbol: s.symbol,
            side,
            orderType,
            intent: s.intent,
            quantity: s.quantity,
            terminalId,
            sl: stops.sl,
            tp: stops.tp,
            status: "PENDING"
        });

        const bridgeStatus = mt5Bridge.getStatus?.() || {};
        const bridgeAvailable = !!bridgeStatus.authorized;
        if (bridgeAvailable) {
            try {
                let result;
                if (s.intent === "ENTER") {
                    const payload = {
                        orderId,
                        symbol: s.symbol,
                        side,
                        lot: s.quantity,
                        volume: s.quantity,
                        quantity: s.quantity,
                        sl: stops.sl,
                        tp: stops.tp,
                        strategyId: s.strategyId
                    };
                    result = await mt5Bridge.openPosition(payload);
                } else {
                    const closePayload = {
                        orderId,
                        symbol: s.symbol,
                        side,
                        quantity: s.quantity,
                        lot: s.quantity,
                        strategyId: s.strategyId
                    };
                    result = await mt5Bridge.closePosition(closePayload);
                }
                await this._updateLiveOrderStatus(orderId, "SENT");
                return { ok: true, dispatched: true, transport: "WS_BRIDGE", orderId, result };
            } catch (err) {
                await this._updateLiveOrderStatus(orderId, "REJECTED");
                throw err;
            }
        }
        return { ok: true, queued: true, transport: "DB_QUEUE", orderId };
    }

    _extractStops(signal = {}) {
        const sl = Number(
            signal.sl ??
            signal.stopLoss ??
            signal.stop_loss ??
            signal.meta?.sl ??
            signal.meta?.stopLoss ??
            0
        );
        const tp = Number(
            signal.tp ??
            signal.takeProfit ??
            signal.take_profit ??
            signal.meta?.tp ??
            signal.meta?.takeProfit ??
            0
        );
        return {
            sl: Number.isFinite(sl) && sl > 0 ? sl : 0,
            tp: Number.isFinite(tp) && tp > 0 ? tp : 0
        };
    }

    _normalizePaperExecutionResult(broker, fallback = {}, brokerResult = null) {
        const explicit = (brokerResult && typeof brokerResult === "object")
            ? (brokerResult.execution && typeof brokerResult.execution === "object" ? brokerResult.execution : brokerResult)
            : (typeof broker?.getLastExecution === "function" ? broker.getLastExecution() : null);
        const ok = explicit?.ok === true || brokerResult?.ok === true || brokerResult === true;
        const reason = explicit?.reason || brokerResult?.reason || (ok ? null : "BROKER_REJECTED");
        const orderObj = brokerResult?.order && typeof brokerResult.order === "object" ? brokerResult.order : null;
        return {
            ok,
            reason,
            strategyId: String(explicit?.strategyId || fallback.strategyId || "").trim(),
            symbol: String(explicit?.symbol || fallback.symbol || "").trim(),
            side: String(explicit?.side || fallback.side || "").toUpperCase(),
            orderType: String(explicit?.orderType || fallback.orderType || "MARKET").toUpperCase(),
            quantity: Number(explicit?.quantity ?? fallback.quantity ?? 0),
            price: Number(explicit?.price ?? 0),
            commission: Number(explicit?.commission ?? 0),
            sl: Number(explicit?.sl ?? fallback.sl ?? 0),
            tp: Number(explicit?.tp ?? fallback.tp ?? 0),
            orderId: String(explicit?.orderId || orderObj?.id || ""),
            clientOrderId: String(explicit?.clientOrderId || orderObj?.clientOrderId || ""),
            timestamp: Number(explicit?.timestamp ?? Date.now())
        };
    }

    async _persistPaperFill(exec = {}) {
        if (!db.hasDbConfig()) return;
        const qty = Number(exec.quantity || 0);
        const price = Number(exec.price || 0);
        const commission = Number(exec.commission || 0);
        if (!Number.isFinite(qty) || qty <= 0) return;
        if (!Number.isFinite(price) || price <= 0) return;

        try {
            const userId = this._extractScopedUserId(exec.strategyId);
            
            await db.withTransaction(async (tx) => {
                const orderRes = await tx.query(
                    `INSERT INTO orders (strategy_id, strategy_name, user_id, symbol, side, order_type, intent, quantity, status, environment, sl, tp, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'FILLED', 'PAPER', $9, $10, COALESCE(to_timestamp($11 / 1000.0), NOW()))
                     RETURNING id`,
                    [
                        null,
                        exec.strategyId || null,
                        userId,
                        exec.symbol,
                        exec.side,
                        exec.orderType || "MARKET",
                        exec.orderType === "CLOSE" ? "EXIT" : "ENTER",
                        qty,
                        Number(exec.sl || 0) || null,
                        Number(exec.tp || 0) || null,
                        Number(exec.timestamp || Date.now())
                    ]
                );
                const orderId = orderRes.rows?.[0]?.id || null;
                if (!orderId) return;

                await tx.query(
                    `INSERT INTO order_fills (order_id, external_deal_id, fill_price, fill_quantity, commission, filled_at)
                     VALUES ($1, $2, $3, $4, $5, COALESCE(to_timestamp($6 / 1000.0), NOW()))`,
                    [orderId, null, price, qty, commission, Number(exec.timestamp || Date.now())]
                );

                await tx.query(
                    `INSERT INTO paper_trades (order_id, strategy_name, user_id, symbol, side, quantity, fill_price, commission, status, environment, created_at, filled_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'FILLED', 'PAPER', COALESCE(to_timestamp($9 / 1000.0), NOW()), COALESCE(to_timestamp($9 / 1000.0), NOW()))`,
                    [orderId, exec.strategyId || null, userId, exec.symbol, exec.side, qty, price, commission, Number(exec.timestamp || Date.now())]
                );
            });
        } catch (err) {
            logger.warn(`[ADAPTER] PAPER persistence failed: ${err.message}`);
        }
    }

    async _insertLiveOrder(exec = {}) {
        if (!db.hasDbConfig()) return null;
        const strategyId = String(exec.strategyId || "").trim() || null;
        const userId = String(parseScopedId(strategyId || "").userId || "").trim() || null;
        const symbol = String(exec.symbol || "").trim().toUpperCase();
        const side = String(exec.side || "").trim().toUpperCase();
        const orderType = String(exec.orderType || "MARKET").trim().toUpperCase();
        const intent = String(exec.intent || "ENTER").trim().toUpperCase();
        const status = String(exec.status || "PENDING").trim().toUpperCase();
        const quantity = Number(exec.quantity || 0);
        const terminalId = String(exec.terminalId || "").trim() || null;
        const sl = Number(exec.sl || 0);
        const tp = Number(exec.tp || 0);

        if (!symbol || !["BUY", "SELL"].includes(side) || !Number.isFinite(quantity) || quantity <= 0) {
            return null;
        }

        try {
            const res = await db.query(
                `INSERT INTO orders (strategy_id, strategy_name, user_id, symbol, side, order_type, intent, quantity, status, environment, terminal_id, sl, tp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'LIVE', $10, $11, $12)
                 RETURNING id`,
                [
                    strategyId,
                    strategyId,
                    userId,
                    symbol,
                    side,
                    orderType,
                    intent,
                    quantity,
                    status,
                    terminalId,
                    Number.isFinite(sl) && sl > 0 ? sl : null,
                    Number.isFinite(tp) && tp > 0 ? tp : null
                ]
            );
            return res.rows?.[0]?.id || null;
        } catch {
            try {
                const res = await db.query(
                    `INSERT INTO orders (strategy_id, strategy_name, user_id, symbol, side, order_type, intent, quantity, status, environment, terminal_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'LIVE', $10)
                     RETURNING id`,
                    [strategyId, strategyId, userId, symbol, side, orderType, intent, quantity, status, terminalId]
                );
                return res.rows?.[0]?.id || null;
            } catch {
                const res = await db.query(
                    `INSERT INTO orders (strategy_id, strategy_name, user_id, symbol, side, order_type, intent, quantity, status, environment)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'LIVE')
                     RETURNING id`,
                    [strategyId, strategyId, userId, symbol, side, orderType, intent, quantity, status]
                );
                return res.rows?.[0]?.id || null;
            }
        }
    }

    async _updateLiveOrderStatus(orderId, status) {
        if (!db.hasDbConfig()) return;
        const id = String(orderId || "").trim();
        if (!id) return;
        const nextStatus = String(status || "").trim().toUpperCase();
        if (!nextStatus) return;
        try {
            await db.query("UPDATE orders SET status = $2 WHERE id = $1", [id, nextStatus]);
        } catch (err) {
            logger.warn(`[ADAPTER] LIVE status update failed for ${id}: ${err.message}`);
        }
    }

    _getBroker(mode, strategyId = null) {
        if (mode === "PAPER") {
            const userId = this._extractScopedUserId(strategyId);
            
            if (typeof this.brokers.PAPER === "function") {
                return this.brokers.PAPER(userId || undefined);
            }
            if (this.brokers.PAPER) return this.brokers.PAPER;
            if (this.mode === "PAPER" && this.broker) return this.broker;
            return getPaperBroker(userId || undefined);
        }
        if (mode === "LIVE") {
            if (this.brokers.LIVE) return this.brokers.LIVE;
            if (this.mode === "LIVE" && this.broker) return this.broker;
            return mt5Bridge;
        }
        return this.broker;
    }

    async _resolveMode(strategyId) {
        if (!db.hasDbConfig()) return this._normalizeMode(this.mode);
        const name = String(strategyId || "").trim();
        if (!name) return this._normalizeMode(this.mode);

        const cached = this._modeCache.get(name);
        if (cached && (Date.now() - cached.loadedAt) <= this._modeCacheTtlMs) {
            return this._normalizeMode(cached.mode);
        }
        try {
            const { rows } = await db.query(
                "SELECT runtime_mode FROM strategies WHERE name = $1 LIMIT 1",
                [name]
            );
            const row = rows[0];
            const resolved = row?.runtime_mode ? this._normalizeMode(row.runtime_mode) : this._normalizeMode(this.mode);
            this._modeCache.set(name, { mode: resolved, loadedAt: Date.now() });
            return resolved;
        } catch (err) {
            logger.warn(`[ADAPTER] Mode lookup failed for ${name}: ${err.message}`);
            return this._normalizeMode(this.mode);
        }
    }
}

module.exports = SignalAdapter;
