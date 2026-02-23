"use strict";

const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");
const db = require("@core/services/postgres");
const { getPaperBroker } = require("@broker/paperStore");
const mt5Bridge = require("@core/services/mt5Bridge");
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
        
        // Internal state to prevent signal collision
        this.processing = new Set();
        this.metrics = {
            handled: 0,
            rejected: 0,
            locked: 0,
            failed: 0
        };
        
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
        this.metrics.handled += 1;
        const normalized = this._normalizeSignal(signal);
        if (!this._isValid(normalized)) {
            this.metrics.rejected += 1;
            return { status: 'REJECTED', reason: 'INVALID_SCHEMA' };
        }

        const mode = await this._resolveMode(normalized.strategyId);
        const lockKey = `${normalized.strategyId}_${normalized.symbol}`;
        if (this.processing.has(lockKey)) {
            logger.warn(`[ADAPTER] Signal locked: ${lockKey} is already awaiting execution.`);
            this.metrics.locked += 1;
            return { status: 'LOCKED' };
        }

        this.processing.add(lockKey);
        bus.emit(EVENTS.STRATEGY.SIGNAL, {
            strategyId: normalized.strategyId,
            symbol: normalized.symbol,
            intent: normalized.intent,
            side: normalized.side,
            quantity: normalized.quantity,
            mode,
            ts: Date.now()
        });

        try {
            let result;
            switch (mode) {
                case "BACKTEST":
                    result = this._execBacktest(normalized);
                    break;
                case "PAPER":
                    result = this._execPaper(normalized, this._getBroker("PAPER"));
                    break;
                case "LIVE":
                    result = await this._execLive(normalized);
                    break;
                default:
                    result = this._execPaper(normalized, this._getBroker("PAPER"));
                    break;
            }
            return result || { status: "REJECTED", reason: "NO_RESULT" };
        } catch (err) {
            this.metrics.failed += 1;
            logger.error(`[ADAPTER] Handle failed (${mode}) for ${normalized.strategyId}: ${err.message}`);
            bus.emit(EVENTS.SYSTEM.ERROR, {
                source: "signal_adapter",
                strategyId: normalized.strategyId,
                symbol: normalized.symbol,
                message: err.message,
                at: new Date().toISOString()
            });
            return { status: "ERROR", reason: err.message };
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
        return {
            ...signal,
            strategyId: String(signal.strategyId || "").trim(),
            symbol: String(signal.symbol || "").trim(),
            intent: String(signal.intent || "").trim().toUpperCase(),
            side: String(signal.side || "flat").trim().toLowerCase(),
            quantity: Number(signal.quantity || 0)
        };
    }

    getMetrics() {
        return {
            ...this.metrics,
            inflightLocks: this.processing.size
        };
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
        db.query(
            `INSERT INTO paper_trades (strategy_name, symbol, side, quantity, status)
             VALUES ($1, $2, $3, $4, 'FILLED')`,
            [s.strategyId, s.symbol, s.side?.toUpperCase?.() === 'SELL' ? 'SELL' : 'BUY', s.quantity]
        ).catch(() => {});
        if (s.intent === "ENTER") {
            return this._paperOpenPosition(s, broker);
        }
        return this._paperClosePosition(s, broker);
    }

    _paperOrderSide(s) {
        const raw = String(s?.side || "").trim().toLowerCase();
        if (raw === "sell" || raw === "short") return "SELL";
        return "BUY";
    }

    _paperOpenPosition(s, broker) {
        const side = this._paperOrderSide(s);
        const qty = Number(s?.quantity || 0) || 0;
        if (qty <= 0) return { status: "REJECTED", reason: "INVALID_QTY" };

        if (typeof broker.execute === "function") {
            return broker.execute(s.symbol, side, qty);
        }
        if (typeof broker.openPosition === "function") {
            return broker.openPosition({ symbol: s.symbol, side, quantity: qty, strategyId: s.strategyId, params: s.meta });
        }
        if (typeof broker.buy === "function" || typeof broker.sell === "function") {
            return side === "BUY"
                ? broker.buy?.(s.symbol, qty)
                : broker.sell?.(s.symbol, qty);
        }
        throw new Error("Paper broker does not implement execute/openPosition/buy-sell API");
    }

    _paperClosePosition(s, broker) {
        if (typeof broker.closePosition === "function") {
            return broker.closePosition(s.symbol);
        }
        if (typeof broker.execute === "function") {
            const existing = broker?.positions?.get?.(s.symbol);
            if (existing && Number(existing.quantity) > 0) {
                const qty = Number(existing.quantity);
                const closeSide = String(existing.side || "").toLowerCase() === "short" ? "BUY" : "SELL";
                return broker.execute(s.symbol, closeSide, qty);
            }
            const fallbackQty = Number(s?.quantity || 0) || 0;
            if (fallbackQty <= 0) return { status: "REJECTED", reason: "NO_OPEN_POSITION" };
            const opposite = this._paperOrderSide(s) === "BUY" ? "SELL" : "BUY";
            return broker.execute(s.symbol, opposite, fallbackQty);
        }
        return { status: "REJECTED", reason: "BROKER_CLOSE_NOT_SUPPORTED" };
    }

    async _execLive(s) {
        if (!db.hasDbConfig()) return { status: "REJECTED", reason: "DB_NOT_CONFIGURED" };
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
                    params: s.meta,
                    strategyId: s.strategyId
                }
            };
        }

        const side = s.side?.toUpperCase?.() === 'SELL' ? 'SELL' : 'BUY';
        const orderType = s.intent === "ENTER" ? "MARKET" : "CLOSE";
        await db.query(
            `INSERT INTO orders (strategy_id, symbol, side, order_type, quantity, status, environment)
             VALUES ($1, $2, $3, $4, $5, 'PENDING', 'LIVE')`,
            [s.strategyId || null, s.symbol, side, orderType, s.quantity]
        );
        return { ok: true, queued: true };
    }

    _getBroker(mode) {
        if (mode === "PAPER") {
            if (this.brokers.PAPER) return this.brokers.PAPER;
            if (this.mode === "PAPER" && this.broker) return this.broker;
            return getPaperBroker();
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
        try {
            const { rows } = await db.query(
                "SELECT runtime_mode FROM strategies WHERE name = $1 LIMIT 1",
                [name]
            );
            const row = rows[0];
            if (!row?.runtime_mode) return this._normalizeMode(this.mode);
            return this._normalizeMode(row.runtime_mode);
        } catch (err) {
            logger.warn(`[ADAPTER] Mode lookup failed for ${name}: ${err.message}`);
            return this._normalizeMode(this.mode);
        }
    }
}

module.exports = SignalAdapter;
