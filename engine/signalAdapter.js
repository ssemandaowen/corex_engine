"use strict";

const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");

class SignalAdapter {
    /**
     * @param {string} mode - BACKTEST | PAPER | LIVE
     * @param {Object} broker - The active broker instance (PaperBroker or MT5Bridge)
     */
    constructor({ mode = "PAPER", broker = null } = {}) {
        this.mode = mode;
        this.broker = broker;
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

        const lockKey = `${signal.strategyId}_${signal.symbol}`;
        if (this.processing.has(lockKey)) {
            logger.warn(`[ADAPTER] Signal locked: ${lockKey} is already awaiting execution.`);
            return { status: 'LOCKED' };
        }

        this.processing.add(lockKey);

        try {
            let result;
            switch (this.mode) {
                case "BACKTEST":
                    result = this._execBacktest(signal);
                    break;
                case "PAPER":
                    result = this._execPaper(signal);
                    break;
                case "LIVE":
                    result = await this._execLive(signal);
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

    _execPaper(s) {
        if (!this.broker) return;
        return s.intent === "ENTER"
            ? (s.side === "long" ? this.broker.buy(s.symbol, s.quantity) : this.broker.sell(s.symbol, s.quantity))
            : this.broker.closePosition(s.symbol);
    }

    async _execLive(s) {
        // This maps 1:1 to the MT5 Bridge Interface we will build
        if (!this.broker) throw new Error("Live broker not initialized");
        
        const action = s.intent === "ENTER" ? "openPosition" : "closePosition";
        return await this.broker[action]({
            symbol: s.symbol,
            side: s.side,
            volume: s.quantity,
            params: s.meta
        });
    }
}

module.exports = SignalAdapter;
