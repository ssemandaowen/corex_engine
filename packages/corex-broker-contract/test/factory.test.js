"use strict";

const factory = require("../src/RuntimeBrokerFactory");
const { MODES, PAPER_BROKER_DEFAULTS, DEFAULT_STRATEGY_CONFIG } = require("@config/constants");
const BacktestDriver = require("../src/drivers/BacktestDriver");
const CoreXPaperDriver = require("../src/drivers/CoreXPaperDriver");
const MetaApiDriver = require("../src/drivers/MetaApiDriver");
const RestDriver = require("../src/drivers/RestDriver");

describe("RuntimeBrokerFactory", () => {
    beforeEach(() => {
        factory.destroyAll();
    });

    test("is a singleton instance", () => {
        const factory2 = require("../src/RuntimeBrokerFactory");
        expect(factory).toBe(factory2);
    });

    test("creates BacktestDriver for BACKTEST mode", () => {
        const broker = factory.createBroker(MODES.BACKTEST, {
            runtimeId: "u1::strat::EURUSD::BACKTEST",
            symbol: "EURUSD"
        });
        expect(broker).toBeInstanceOf(BacktestDriver);
        expect(broker.supports_trading).toBe(true);
        expect(broker.supports_streaming_data).toBe(true);
    });

    test("creates CoreXPaperDriver for PAPER mode", () => {
        const broker = factory.createBroker(MODES.PAPER, {
            runtimeId: "u1::strat::EURUSD::PAPER",
            symbol: "EURUSD",
            userId: "u1"
        });
        expect(broker).toBeInstanceOf(CoreXPaperDriver);
        expect(broker.mode).toBe("PAPER");
        expect(broker.initialCash).toBe(PAPER_BROKER_DEFAULTS.INITIAL_CASH);
    });

    test("creates MetaApiDriver for LIVE mode with metaapi connector", () => {
        const broker = factory.createBroker(MODES.LIVE, {
            runtimeId: "u1::strat::EURUSD::LIVE",
            symbol: "EURUSD",
            userId: "u1",
            connectorType: "metaapi"
        });
        expect(broker).toBeInstanceOf(MetaApiDriver);
        expect(broker.supports_streaming_data).toBe(false);
    });

    test("creates RestDriver for LIVE mode with rest/mt5 connector", () => {
        const broker = factory.createBroker(MODES.LIVE, {
            runtimeId: "u1::strat::EURUSD::LIVE",
            symbol: "EURUSD",
            userId: "u1",
            connectorType: "rest"
        });
        expect(broker).toBeInstanceOf(RestDriver);
    });

    test("normalizes lowercase mode strings", () => {
        const broker = factory.createBroker("backtest", {
            runtimeId: "u1::strat::BTCUSD::BACKTEST",
            symbol: "BTCUSD"
        });
        expect(broker).toBeInstanceOf(BacktestDriver);
    });

    test("throws if runtimeId is missing", () => {
        expect(() => factory.createBroker(MODES.BACKTEST, { symbol: "EURUSD" }))
            .toThrow(/runtimeId parameter is strictly required/);
    });

    test("throws for invalid mode", () => {
        expect(() => factory.createBroker("INVALID", { runtimeId: "r1" }))
            .toThrow(/No driver registered for type 'INVALID'/);
    });

    test("enforces same-symbol-one-driver rule at session creation", () => {
        factory.createBroker(MODES.BACKTEST, {
            runtimeId: "u1::strat::EURUSD::BACKTEST",
            symbol: "EURUSD"
        });

        expect(() => factory.createBroker(MODES.PAPER, {
            runtimeId: "u2::strat::EURUSD::PAPER",
            symbol: "EURUSD"
        })).toThrow(/already has an active session/);
    });

    test("allows different symbols to run different drivers concurrently", () => {
        factory.createBroker(MODES.BACKTEST, {
            runtimeId: "u1::strat::EURUSD::BACKTEST",
            symbol: "EURUSD"
        });

        const broker = factory.createBroker(MODES.PAPER, {
            runtimeId: "u2::strat::GBPUSD::PAPER",
            symbol: "GBPUSD"
        });

        expect(broker).toBeInstanceOf(CoreXPaperDriver);
    });

    test("allows same symbol+driver on different symbols", () => {
        const b1 = factory.createBroker(MODES.BACKTEST, { runtimeId: "r1", symbol: "EURUSD" });
        const b2 = factory.createBroker(MODES.BACKTEST, { runtimeId: "r2", symbol: "GBPUSD" });
        expect(b1).toBeInstanceOf(BacktestDriver);
        expect(b2).toBeInstanceOf(BacktestDriver);
    });

    test("BacktestDriver uses DEFAULT_STRATEGY_CONFIG.INITIAL_CASH", () => {
        const broker = factory.createBroker(MODES.BACKTEST, { runtimeId: "r1", symbol: "EURUSD" });
        expect(broker.initialCash).toBe(DEFAULT_STRATEGY_CONFIG.INITIAL_CASH);
    });

    test("getSession returns session for existing symbol", () => {
        factory.createBroker(MODES.BACKTEST, { runtimeId: "r1", symbol: "EURUSD" });
        const session = factory.getSession("EURUSD");
        expect(session).toBeDefined();
        expect(session.driverType).toBe("BACKTEST");
    });

    test("hasSession returns true for existing symbol", () => {
        factory.createBroker(MODES.BACKTEST, { runtimeId: "r1", symbol: "EURUSD" });
        expect(factory.hasSession("EURUSD")).toBe(true);
        expect(factory.hasSession("GBPUSD")).toBe(false);
    });

    test("destroySession removes session", () => {
        factory.createBroker(MODES.BACKTEST, { runtimeId: "r1", symbol: "EURUSD" });
        expect(factory.hasSession("EURUSD")).toBe(true);
        factory.destroySession("EURUSD");
        expect(factory.hasSession("EURUSD")).toBe(false);
    });

    test("same symbol with same driver type is allowed", () => {
        const b1 = factory.createBroker(MODES.BACKTEST, { runtimeId: "r1", symbol: "EURUSD" });
        expect(() => factory.createBroker(MODES.BACKTEST, { runtimeId: "r2", symbol: "EURUSD" })).not.toThrow();
    });
});
