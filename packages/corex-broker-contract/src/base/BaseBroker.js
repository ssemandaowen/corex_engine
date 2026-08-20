"use strict";

const EventEmitter = require("events");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");
const StrategyPositionManager = require("@utils/strategy/StrategyPositionManager");
const { BrokerContract, UnsupportedOperationError } = require("./BrokerContract");
const SymbolNormalizer = require("../utils/SymbolNormalizer");

class BaseBroker extends EventEmitter {
    constructor(config = {}) {
        super();

        if (this.constructor === BaseBroker) {
            throw new TypeError("[BaseBroker] Cannot instantiate abstract parent class directly.");
        }
        if (!config.runtimeId) {
            throw new Error("[BaseBroker] Initialization failed: runtimeId is strictly required.");
        }

        this._validateContractImplementation();

        this.runtimeId = config.runtimeId;
        const normalized = SymbolNormalizer.normalize(config.symbol || "");
        this.symbol = normalized.symbol;
        this.pipScale = normalized.pipScale;
        this.digits = normalized.digits;
        this.userId = config.userId || "system";
        this.mode = config.mode || "PAPER";
        this.initialCash = Number(config.initialCash || 100000);
        this.cash = this.initialCash;
        this.positions = new StrategyPositionManager();
        this.config = config.brokerConfig || {};
        this._ready = false;

        this.supports_trading = true;
        this.supports_streaming_data = false;
    }

    _validateContractImplementation() {
        const requiredMethods = [
            "initialize",
            "resetState",
            "destroy",
            "submit",
            "modify",
            "cancel",
            "query_status",
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
                    "See BrokerContract for the required interface."
                );
            }
        }
    }

    _normalizePayload(signal) {
        const { symbol: normalizedSymbol } = SymbolNormalizer.normalize(signal.symbol || this.symbol);
        const intent = String(signal.intent || "").toUpperCase();
        const side = String(signal.side || "long").toLowerCase();
        const isBuy = side === "long" || side === "buy";

        if (intent === "EXIT") {
            return {
                Symbol: normalizedSymbol,
                Volume: Number(signal.quantity) || 0,
                OrderType: "MARKET",
                Side: isBuy ? "SELL" : "BUY",
                StopLoss: signal.tp || signal.StopLoss,
                TakeProfit: signal.sl || signal.TakeProfit
            };
        }

        return {
            Symbol: normalizedSymbol,
            Volume: Number(signal.quantity) || 0,
            OrderType: String(signal.orderType || signal.OrderType || "MARKET").toUpperCase(),
            Side: isBuy ? "BUY" : "SELL",
            Price: signal.price || signal.Price,
            StopPrice: signal.stopPrice || signal.StopPrice,
            StopLoss: signal.sl || signal.StopLoss,
            TakeProfit: signal.tp || signal.TakeProfit
        };
    }

    async handle(signal) {
        if (!this._ready) await this._waitReady();

        if (!this._passesRiskFloor()) {
            logger.error(`[${this.mode}] RISK FLOOR HIT for ${this.runtimeId} â€” signal blocked`);
            return { status: "REJECTED", reason: "RISK_FLOOR" };
        }

        const intent = String(signal.intent || "").toUpperCase();
        try {
            const payload = this._normalizePayload(signal);
            const result = intent === "EXIT"
                ? await this.submit(payload)
                : await this.placeOrder(signal);
            this._emitPortfolioUpdate();
            return result;
        } catch (err) {
            logger.error(`[${this.mode}] handle() error: ${err.message}`);
            return { status: "ERROR", reason: err.message };
        }
    }

    async placeOrder(signal) {
        const payload = this._normalizePayload(signal);
        return this.submit(payload);
    }

    async closePosition(signal) {
        const payload = this._normalizePayload({ ...signal, intent: "EXIT" });
        return this.submit(payload);
    }

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

    _checkEntryMargin(qty, price) {
        const { leverage, usedMargin, equity } = this.getMarginStatus();
        const additionalMargin = (Math.abs(Number(qty) || 0) * (Number(price) || 0)) / leverage;
        return (usedMargin + additionalMargin) <= equity;
    }

    async _checkMarginGuardrails() {
        const stopOutPct = Number(this.config?.stopOut);
        const marginCallPct = Number(this.config?.marginCall);
        if (!Number.isFinite(stopOutPct) && !Number.isFinite(marginCallPct)) return false;

        const { marginLevel, usedMargin } = this.getMarginStatus();
        if (usedMargin <= 0) return false;

        if (Number.isFinite(stopOutPct) && marginLevel <= stopOutPct) {
            bus.emit(EVENTS.SYSTEM.LOG,
                { level: "error", module: "BROKER_RISK", message: `Stop-out triggered at ${marginLevel.toFixed(1)}% margin level â€” closing all positions`, category: "execution" },
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

    async _persist() {}

    getPerformanceMetrics() {
        return { trades: [], finalEquity: this.getEquity() };
    }

    resetState() {}

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

BaseBroker.UnsupportedOperationError = UnsupportedOperationError;

module.exports = BaseBroker;
