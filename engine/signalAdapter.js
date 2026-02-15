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
        this.mode = mode;
        this.broker = broker;
        this.brokers = brokers || {};
        this.btContext = null;
        
        // Internal state to prevent signal collision
        this.processing = new Set(); 
        
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
        if (!this._isValid(signal)) return { status: 'REJECTED', reason: 'INVALID_SCHEMA' };

        const mode = await this._resolveMode(signal.strategyId);
        const lockKey = `${signal.strategyId}_${signal.symbol}`;
        if (this.processing.has(lockKey)) {
            logger.warn(`[ADAPTER] Signal locked: ${lockKey} is already awaiting execution.`);
            return { status: 'LOCKED' };
        }

        this.processing.add(lockKey);
        bus.emit(EVENTS.STRATEGY.SIGNAL, {
            strategyId: signal.strategyId,
            symbol: signal.symbol,
            intent: signal.intent,
            side: signal.side,
            quantity: signal.quantity,
            mode,
            ts: Date.now()
        });

        try {
            let result;
            switch (mode) {
                case "BACKTEST":
                    result = this._execBacktest(signal);
                    break;
                case "PAPER":
                    result = this._execPaper(signal, this._getBroker("PAPER"));
                    break;
                case "LIVE":
                    result = await this._execLive(signal);
                    break;
                default:
                    result = this._execPaper(signal, this._getBroker("PAPER"));
                    break;
            }
            return result;
        } finally {
            this.processing.delete(lockKey);
        }
    }

    /**
     * Synchronous handler for backtests (no async, no locks).
     */
    handleSync(signal) {
        if (!this._isValid(signal)) return { status: 'REJECTED', reason: 'INVALID_SCHEMA' };
        if (this.mode !== "BACKTEST") return { status: 'REJECTED', reason: 'SYNC_ONLY_BACKTEST' };
        return this._execBacktest(signal);
    }

    _isValid(s) {
        const required = ['strategyId', 'symbol', 'intent'];
        return required.every(field => s && s[field]);
    }

    // --- Execution Logic Blocks ---

    _execBacktest(s) {
        if (!this.btContext) return;
        if (s.intent === "ENTER") {
            return this.btContext.enter({ direction: s.side });
        }
        return this.btContext.exit();
    }

    _execPaper(s, broker) {
        if (!broker) return;
        db.query(
            `INSERT INTO paper_trades (strategy_name, symbol, side, quantity, status)
             VALUES ($1, $2, $3, $4, 'FILLED')`,
            [s.strategyId, s.symbol, s.side?.toUpperCase?.() === 'SELL' ? 'SELL' : 'BUY', s.quantity]
        ).catch(() => {});
        return s.intent === "ENTER"
            ? (s.side === "long" ? broker.buy(s.symbol, s.quantity) : broker.sell(s.symbol, s.quantity))
            : broker.closePosition(s.symbol);
    }

    async _execLive(s) {
        if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
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
            [null, s.symbol, side, orderType, s.quantity]
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
        if (!db.hasDbConfig()) return this.mode || "PAPER";
        const name = String(strategyId || "").trim();
        if (!name) return this.mode || "PAPER";
        try {
            const { rows } = await db.query(
                "SELECT runtime_mode FROM strategies WHERE name = $1 LIMIT 1",
                [name]
            );
            const row = rows[0];
            if (!row?.runtime_mode) return this.mode || "PAPER";
            return String(row.runtime_mode).toUpperCase();
        } catch (err) {
            logger.warn(`[ADAPTER] Mode lookup failed for ${name}: ${err.message}`);
            return this.mode || "PAPER";
        }
    }
}

module.exports = SignalAdapter;
