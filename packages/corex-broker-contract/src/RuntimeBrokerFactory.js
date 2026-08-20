"use strict";

const { MODES, PAPER_BROKER_DEFAULTS, DEFAULT_STRATEGY_CONFIG } = require("@config/constants");
const BacktestDriver = require("./drivers/BacktestDriver");
const CoreXPaperDriver = require("./drivers/CoreXPaperDriver");
const MetaApiDriver = require("./drivers/MetaApiDriver");
const RestDriver = require("./drivers/RestDriver");

const DRIVER_REGISTRY = {
    BACKTEST: BacktestDriver,
    PAPER: CoreXPaperDriver,
    LIVE: MetaApiDriver,
    METAAPI: MetaApiDriver,
    REST: RestDriver,
    MT5: RestDriver,
    MQL5: RestDriver
};

class RuntimeBrokerFactory {
    constructor() {
        this._sessions = new Map();
    }

    createBroker(mode, opts = {}) {
        if (!opts.runtimeId) {
            throw new Error("[BrokerFactory] Allocation aborted: runtimeId parameter is strictly required.");
        }

        const normalizedMode = String(mode).toUpperCase();
        const assetSymbol = String(opts.symbol || "").toUpperCase();

        if (assetSymbol) {
            const existing = this._sessions.get(assetSymbol);
            if (existing && existing.driverType !== this._resolveDriverType(normalizedMode, opts)) {
                throw new Error(
                    `[BrokerFactory] Session creation rejected: symbol '${assetSymbol}' already has an active ` +
                    `session with driver '${existing.driverType}'. Same symbol cannot run two drivers simultaneously.`
                );
            }
        }

        const DriverClass = this._resolveDriver(normalizedMode, opts);
        const driverType = this._resolveDriverType(normalizedMode, opts);

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
                connectorType: opts.connectorType || "metaapi",
                mode: "LIVE",
                initialCash: 0,
                brokerConfig: opts.brokerConfig || {}
            });
            break;

        case "REST":
            broker = new RestDriver({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                userId: opts.userId,
                mode: "LIVE",
                initialCash: 0,
                brokerConfig: opts.brokerConfig || {}
            });
            break;

        default:
            throw new Error(`[BrokerFactory] Production failure: execution mode '${mode}' maps to no valid driver.`);
        }

        if (assetSymbol) {
            this._sessions.set(assetSymbol, {
                driverType,
                mode: normalizedMode,
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
            if (connectorType === "REST" || connectorType === "MT5" || connectorType === "MQL5") return "REST";
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

    getSession(symbol) {
        return this._sessions.get(String(symbol || "").toUpperCase());
    }

    hasSession(symbol) {
        return this._sessions.has(String(symbol || "").toUpperCase());
    }

    destroySession(symbol) {
        const key = String(symbol || "").toUpperCase();
        const session = this._sessions.get(key);
        if (session) {
            if (typeof session.instance.destroy === "function") {
                session.instance.destroy().catch(() => {});
            }
            this._sessions.delete(key);
        }
    }

    destroyAll() {
        for (const [symbol, session] of this._sessions) {
            if (typeof session.instance.destroy === "function") {
                session.instance.destroy().catch(() => {});
            }
        }
        this._sessions.clear();
    }
}

module.exports = new RuntimeBrokerFactory();
