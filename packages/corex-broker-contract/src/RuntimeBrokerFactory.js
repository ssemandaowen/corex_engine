"use strict";

const { MODES, PAPER_BROKER_DEFAULTS, DEFAULT_STRATEGY_CONFIG } = require("@config/constants");
const BacktestDriver = require("./drivers/BacktestDriver");
const CoreXPaperDriver = require("./drivers/CoreXPaperDriver");
const MetaApiDriver = require("./drivers/MetaApiDriver");

const DRIVER_REGISTRY = {
    BACKTEST: BacktestDriver,
    PAPER: CoreXPaperDriver,
    LIVE: MetaApiDriver,
    METAAPI: MetaApiDriver,
};

class RuntimeBrokerFactory {
    constructor() {
        this._sessions = new Map();
    }

    _getSessionKey(mode, opts = {}) {
        const normalizedMode = String(mode).toUpperCase();
        const assetSymbol = String(opts.symbol || "").toUpperCase();
        const accountId = opts.accountId || opts.userId || opts.brokerConfig?.accountId || "system";
        return `${accountId}::${normalizedMode}::${assetSymbol}`;
    }

    createBroker(mode, opts = {}) {
        if (!opts.runtimeId) {
            throw new Error("[BrokerFactory] Allocation aborted: runtimeId parameter is strictly required.");
        }

        const normalizedMode = String(mode).toUpperCase();
        const assetSymbol = String(opts.symbol || "").toUpperCase();
        const driverType = this._resolveDriverType(normalizedMode, opts);

        if (assetSymbol) {
            const sessionKey = this._getSessionKey(normalizedMode, opts);
            const existing = this._sessions.get(sessionKey);
            if (existing && existing.driverType !== driverType) {
                throw new Error(
                    `[BrokerFactory] Session creation rejected: symbol '${assetSymbol}' already has an active ` +
                    `session with driver '${existing.driverType}' for this account and mode. Same symbol cannot run two conflicting drivers simultaneously.`
                );
            }
        }

        const DriverClass = this._resolveDriver(normalizedMode, opts);

        let broker;

        switch (driverType) {
        case "BACKTEST":
            broker = new BacktestDriver({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                initialCash: Number(opts.initialCash || DEFAULT_STRATEGY_CONFIG.INITIAL_CASH),
                mode: "BACKTEST",
                brokerConfig: opts.brokerConfig || {}
            });
            break;

        case "PAPER":
            broker = new CoreXPaperDriver({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                userId: opts.userId || "system_fallback",
                accountId: opts.accountId || opts.brokerConfig?.accountId || null,
                initialCash: Number(opts.initialCash || PAPER_BROKER_DEFAULTS.INITIAL_CASH),
                mode: "PAPER",
                brokerConfig: {
                    slippageBps: PAPER_BROKER_DEFAULTS.SLIPPAGE_BPS,
                    spreadBps: PAPER_BROKER_DEFAULTS.SPREAD_BPS,
                    leverage: PAPER_BROKER_DEFAULTS.LEVERAGE,
                    fillPolicy: opts.brokerConfig?.fillPolicy || "instant",
                    dataSource: opts.brokerConfig?.dataSource || null,
                    ...(opts.brokerConfig || {})
                }
            });
            break;

        case "METAAPI":
            broker = new MetaApiDriver({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                userId: opts.userId,
                accountId: opts.accountId || opts.brokerConfig?.accountId || null,
                connectorType: opts.connectorType || "metaapi",
                mode: "LIVE",
                initialCash: 0,
                brokerConfig: opts.brokerConfig || {}
            });
            break;

        default:
            throw new Error(`[BrokerFactory] Production failure: execution mode '${mode}' maps to no valid driver.`);
        }

        if (assetSymbol) {
            const sessionKey = this._getSessionKey(normalizedMode, opts);
            this._sessions.set(sessionKey, {
                driverType,
                mode: normalizedMode,
                accountId: opts.accountId || opts.userId || opts.brokerConfig?.accountId || "system",
                symbol: assetSymbol,
                instance: broker,
                createdAt: Date.now()
            });
        }

        return broker;
    }

    _resolveDriverType(mode, opts) {
        const connectorType = String(opts.connectorType || "").toUpperCase();
        if (opts.driverType) return String(opts.driverType || "").toUpperCase();

        switch (mode) {
        case MODES.BACKTEST:
            return "BACKTEST";
        case MODES.PAPER:
            return "PAPER";
        case MODES.LIVE:
            return "METAAPI";
        default:
            return mode;
        }
    }

    _resolveDriver(mode, opts) {
        const driverType = this._resolveDriverType(mode, opts);
        const DriverClass = DRIVER_REGISTRY[driverType];
        if (!DriverClass) {
            throw new Error(`[BrokerFactory] No driver registered for type '${driverType}'`);
        }
        return DriverClass;
    }

    getSession(symbol, opts = {}) {
        const options = typeof opts === "string" ? { symbol: opts } : opts;
        const sessionKey = this._getSessionKey(options.mode || "PAPER", { symbol, ...options });
        const direct = this._sessions.get(sessionKey);
        if (direct) return direct;
        const canonical = String(symbol || "").toUpperCase();
        for (const session of this._sessions.values()) {
            if (session.symbol === canonical) return session;
        }
        return null;
    }

    hasSession(symbol, opts = {}) {
        return !!this.getSession(symbol, opts);
    }

    destroySession(symbol, opts = {}) {
        const options = typeof opts === "string" ? { symbol: opts } : opts;
        const canonical = String(symbol || "").toUpperCase();
        for (const [key, session] of this._sessions.entries()) {
            if (session.symbol === canonical && (!options.mode || session.mode === String(options.mode).toUpperCase())) {
                if (typeof session.instance.destroy === "function") {
                    session.instance.destroy().catch(() => {});
                }
                this._sessions.delete(key);
            }
        }
    }

    destroyAll() {
        for (const [key, session] of this._sessions) {
            if (typeof session.instance.destroy === "function") {
                session.instance.destroy().catch(() => {});
            }
        }
        this._sessions.clear();
    }
}

module.exports = new RuntimeBrokerFactory();
