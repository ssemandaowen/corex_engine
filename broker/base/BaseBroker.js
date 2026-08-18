// broker/base/BaseBroker.js
"use strict";

const EventEmitter = require("events");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");
const StrategyPositionManager = require("@utils/strategy/StrategyPositionManager");
const { BrokerContract } = require("./BrokerContract");

/**
 * CoreX Base Broker Abstract Interface
 * Establishes the contract for trade settlement, balance tracking, and snapshot isolation.
 * 
 * See BrokerContract.js for the strict interface that all brokers must implement.
 */
class BaseBroker extends EventEmitter {
    /**
     * @param {Object} config
     * @param {string} config.runtimeId - Scoped instance tracking key
     * @param {string} config.symbol - Associated financial instrument
     */
    constructor(config = {}) {
        super();

        if (this.constructor === BaseBroker) {
            throw new TypeError("[BaseBroker] Cannot instantiate abstract parent class directly.");
        }
        if (!config.runtimeId) {
            throw new Error("[BaseBroker] Initialization failed: runtimeId is strictly required.");
        }
        
        // Validate that subclass implements the BrokerContract
        this._validateContractImplementation();

        this.runtimeId = config.runtimeId;
        this.symbol = String(config.symbol || "").toUpperCase();
        this.userId = config.userId || "system";
        this.mode = config.mode || "PAPER";
        this.initialCash = Number(config.initialCash || 100000);
        this.cash = this.initialCash;
        this.positions = new StrategyPositionManager();
        this.config = config.brokerConfig || {};
        this._ready = false;
    }

    /**
     * Validate that the subclass implementation provides all required contract methods.
     * Throws an error if any required method is missing or not properly overridden.
     * 
     * @throws {Error} if contract is not fully implemented
     * @private
     */
    _validateContractImplementation() {
        const requiredMethods = [
            "initialize",
            "resetState",
            "destroy",
            "placeOrder",
            "getPosition",
            "getAccount",
            "getPerformanceMetrics",
            "onBar"
        ];

        for (const method of requiredMethods) {
            if (typeof this[method] !== "function" || this[method] === BrokerContract.prototype[method]) {
                throw new Error(
                    `[${this.constructor.name}] BrokerContract violation: ` +
                    `method '${method}()' must be implemented by subclass. ` +
                    "See broker/base/BrokerContract.js for interface definition."
                );
            }
        }
    }

    /** Called by SignalAdapter — dispatches to placeOrder or closePosition. */
    async handle(signal) {
        if (!this._ready) await this._waitReady();

        // Shared risk check: prevent trading if equity is below a certain percentage of initial cash
        if (!this._passesRiskFloor()) {
            logger.error(`[${this.mode}] RISK FLOOR HIT for ${this.runtimeId} — signal blocked`);
            return { status: "REJECTED", reason: "RISK_FLOOR" };
        }

        const intent = String(signal.intent || "").toUpperCase();
        try {
            const result = intent === "EXIT"
                ? await this.closePosition(signal)
                : await this.placeOrder(signal);
            this._emitPortfolioUpdate();
            return result;
        } catch (err) {
            logger.error(`[${this.mode}] handle() error: ${err.message}`);
            return { status: "ERROR", reason: err.message };
        }
    }

    /**
     * Executes an incoming approved IntentObject contract.
     * @param {Object} intent - Standard frozen transaction intent payload
     * @param {Object} marketData - Current OHLCV bar packet reference matrix
     * @returns {Promise<Object>} Execution receipt metadata format
     */
    async execute(intent, marketData) {
        throw new Error("[BaseBroker] Method 'execute()' must be implemented by subclass.");
    }

    /**
     * Compiles and outputs a read-only snapshot view of the active trade metrics.
     * @param {string} symbol
     * @returns {Object} { positions: {}, openCount: 0, totalUnrealized: 0 }
     */
    getPositionSnapshot(symbol) {
        throw new Error("[BaseBroker] Method 'getPositionSnapshot()' must be implemented by subclass.");
    }

    /**
     * Returns the current balance equity for risk or sizing checks.
     * @returns {number}
     */
    getEquity() {
        throw new Error("[BaseBroker] Method 'getEquity()' must be implemented by subclass.");
    }

    /**
     * Combined account + open-position view used by the account/balance
     * routes (systemController.js) and by _emitPortfolioUpdate() below
     * (the WS PORTFOLIO_UPDATE broadcast fired after every handled signal).
     * Built generically from getAccount() + getPositionSnapshot(), which
     * every concrete broker (Paper/Live/Backtest) already implements —
     * avoids duplicating each subclass's internal position representation.
     * @returns {Object}
     */
    getAccountSnapshot() {
        const account = this.getAccount();
        const posSnap = this.getPositionSnapshot() || {};
        const positionsBySymbol = posSnap.positions || {};
        const positions = Object.entries(positionsBySymbol).map(([symbol, pos]) => ({
            symbol,
            ...pos
        }));

        return {
            ...account,
            mode: this.mode,
            runtimeId: this.runtimeId,
            positions,
            openCount: posSnap.openCount ?? positions.length,
            totalUnrealized: posSnap.totalUnrealized ?? 0,
            config: this.config || {}
        };
    }

    /**
     * MARGIN / LEVERAGE ENGINE (shared by Paper + Live)
     * ==================================================
     * usedMargin  = sum(|qty| * entryPrice) / leverage, across open positions
     * marginLevel = equity / usedMargin * 100 (Infinity if nothing is open)
     *
     * config.leverage   - max leverage multiplier (default 1 = no leverage)
     * config.marginCall - marginLevel %% threshold that logs a warning
     * config.stopOut    - marginLevel %% threshold that force-closes everything
     */
    getMarginStatus() {
        const leverage = Number(this.config?.leverage) > 0 ? Number(this.config.leverage) : 1;
        const posSnap = this.getPositionSnapshot() || {};
        const positions = Object.values(posSnap.positions || {});
        const usedMargin = positions.reduce((sum, p) => {
            const qty = Math.abs(Number(p.quantity ?? p.volume ?? 0));
            const price = Number(p.entryPrice ?? p.openPrice ?? 0);
            return sum + (qty * price) / leverage;
        }, 0);
        const equity = this.getEquity();
        const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : Infinity;
        return { leverage, usedMargin, equity, marginLevel };
    }

    /**
     * Checks whether a new order of the given size can be opened without
     * breaching the configured leverage. Returns true if there's room.
     */
    _checkEntryMargin(qty, price) {
        const { leverage, usedMargin, equity } = this.getMarginStatus();
        const additionalMargin = (Math.abs(Number(qty) || 0) * (Number(price) || 0)) / leverage;
        return (usedMargin + additionalMargin) <= equity;
    }

    /**
     * Call after every price update (onBar/onTick) or fill. Emits a
     * margin-call warning once when breached, and force-closes every open
     * position if the stop-out threshold is hit.
     * @returns {Promise<boolean>} true if a stop-out liquidation fired
     */
    async _checkMarginGuardrails() {
        const stopOutPct = Number(this.config?.stopOut);
        const marginCallPct = Number(this.config?.marginCall);
        if (!Number.isFinite(stopOutPct) && !Number.isFinite(marginCallPct)) return false;

        const { marginLevel, usedMargin } = this.getMarginStatus();
        if (usedMargin <= 0) return false;

        if (Number.isFinite(stopOutPct) && marginLevel <= stopOutPct) {
            bus.emit(EVENTS.SYSTEM.LOG,
                { level: "error", module: "BROKER_RISK", message: `Stop-out triggered at ${marginLevel.toFixed(1)}% margin level — closing all positions`, category: "execution" },
                { ts: Date.now(), category: "execution", userId: this.userId });
            await this._forceCloseAll();
            this._marginCallWarned = false;
            return true;
        }

        if (Number.isFinite(marginCallPct) && marginLevel <= marginCallPct) {
            if (!this._marginCallWarned) {
                this._marginCallWarned = true;
                bus.emit(EVENTS.SYSTEM.LOG,
                    { level: "warn", module: "BROKER_RISK", message: `Margin call: margin level at ${marginLevel.toFixed(1)}%`, category: "execution" },
                    { ts: Date.now(), category: "execution", userId: this.userId });
            }
        } else {
            this._marginCallWarned = false;
        }
        return false;
    }

    /**
     * Force-closes every open position via the subclass's own closePosition()
     * implementation (Paper/Live both already provide one), so this stays
     * generic instead of duplicating each subclass's exit mechanics.
     */
    async _forceCloseAll() {
        const posSnap = this.getPositionSnapshot() || {};
        const positions = posSnap.positions || {};
        for (const [symbol, pos] of Object.entries(positions)) {
            try {
                await this.closePosition({
                    symbol,
                    quantity: pos.quantity ?? pos.volume,
                    side: pos.side
                });
            } catch (err) {
                logger.warn?.(`[BaseBroker] Force-close failed for ${symbol}: ${err.message}`);
            }
        }
    }

    _passesRiskFloor() {
        const floor = this.config?.riskFloor ?? 0;
        if (!floor || !this.initialCash) return true;
        return this.getEquity() >= this.initialCash * floor;
    }

    _emitPortfolioUpdate() {
        const snapshot = this.getAccountSnapshot();
        bus.emit(EVENTS.POSITION.PORTFOLIO_UPDATE, {
            ...snapshot,
            runtimeId: this.runtimeId
        });
    }

    /**
     * BROKER STATE CHANGE EMISSION HELPER
     * 
     * Emits EVENTS.BROKER.STATE_CHANGED event to trigger automatic persistence.
     * 
     * INTEGRATION FLOW (The Clear Syntax):
     * ====================================
     * 1. Broker method (setCash, updateConfig, etc.) is called
     * 2. Broker updates internal state (this.cash = X, etc.)
     * 3. Broker calls this._emitBrokerState({ cash: X, ...})
     * 4. Event emitted: bus.emit(EVENTS.BROKER.STATE_CHANGED, event)
     * 5. brokerPersistence service listener catches the event
     * 6. brokerPersistence calls pgStore.upsertBrokerSettingsForUser()
     * 7. Database is updated asynchronously
     * 
     * KEY PRINCIPLE: Brokers do NOT call pgStore directly.
     * Instead, brokers emit events. The brokerPersistence service
     * listens and handles all database writes. This ensures:
     * - Clean separation of concerns
     * - Centralized persistence logic
     * - Easy testability
     * - No duplicate writes
     * 
     * PAYLOAD SHAPE:
     * - Any object representing the changed state
     * - Examples: { cash: 50000 }, { config: {...} }, { initialCash: 100000 }
     * - Will be wrapped with userId and mode before emission
     * 
     * ERROR HANDLING:
     * - Wrapped in try/catch to prevent broker crashes
     * - Logs errors but does not throw
     * - Prevents a single bad event from cascading failures
     * 
     * @param {Object} payload - Object with changed fields (cash, config, initialCash, etc.)
     * 
     * Usage Examples:
     * ---------------
     * // In setCash() method:
     * this.cash = value;
     * this._emitBrokerState({ cash: value });
     * 
     * // In updateConfig() method:
     * this.config = { ...this.config, ...nextConfig };
     * this._emitBrokerState({ config: this.config });
     * 
     * // In resetAccount() method:
     * this.cash = initialCash;
     * this.positions.clear();
     * this._emitBrokerState({ cash: this.cash, positions: [] });
     * 
     * See: docs/BROKER_PERSISTENCE_INTEGRATION.md
     * See: examples/IntegratedStrategy.js
     */
    _emitBrokerState(payload = {}) {
        try {
            bus.emit(EVENTS.BROKER.STATE_CHANGED, {
                userId: this.userId,
                mode: this.mode,
                payload: payload || {}
            });
        } catch (err) {
            logger.error(`[BaseBroker] _emitBrokerState failed: ${err.message}`);
        }
    }

    async _persist() {
        // Implementation depends on pgStore, to be called by subclasses
    }

    /**
     * Returns historical transaction records for performance reporting.
     * @returns {Object}
     */
    getPerformanceMetrics() {
        return { trades: [], finalEquity: this.getEquity() };
    }

    /**
     * Resets internal transaction maps back to zero baseline metrics (vital for backtesting).
     */
    resetState() {
        // Optional implementation mapping layer inside concrete subclasses
    }

    /**
     * Structural cleanup called during strategy teardowns or process reboots.
     */
    async cleanup() {
        this._ready = false;
    }

    _waitReady(timeout = 5000) {
        const start = Date.now();
        return new Promise((res, rej) => {
            const check = () => {
                if (this._ready) return res();
                if (Date.now() - start > timeout) return rej(new Error(`${this.mode} broker not ready`));
                setTimeout(check, 50);
            };
            check();
        });
    }
}

module.exports = BaseBroker;