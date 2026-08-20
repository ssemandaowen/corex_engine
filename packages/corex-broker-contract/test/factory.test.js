"use strict";

const factory = require("../src/RuntimeBrokerFactory");
const BacktestBroker = require("../src/modes/BacktestBroker");
const PaperBroker = require("../src/modes/PaperBroker");
const LiveBroker = require("../src/modes/LiveBroker");
const { MODES, DEFAULT_STRATEGY_CONFIG, PAPER_BROKER_DEFAULTS } = require("@config/constants");

describe("RuntimeBrokerFactory", () => {
    test("is a singleton instance", () => {
        const factory2 = require("../src/RuntimeBrokerFactory");
        expect(factory).toBe(factory2);
    });

    test("creates BacktestBroker for BACKTEST mode", () => {
        const broker = factory.createBroker(MODES.BACKTEST, {
            runtimeId: "u1::strat::EURUSD::BACKTEST",
            symbol: "EURUSD"
        });
        expect(broker).toBeInstanceOf(BacktestBroker);
        expect(broker.mode).toBe("PAPER");
        expect(broker.runtimeId).toBe("u1::strat::EURUSD::BACKTEST");
    });

    test("creates PaperBroker for PAPER mode", () => {
        const broker = factory.createBroker(MODES.PAPER, {
            runtimeId: "u1::strat::EURUSD::PAPER",
            symbol: "EURUSD",
            userId: "u1"
        });
        expect(broker).toBeInstanceOf(PaperBroker);
        expect(broker.mode).toBe("PAPER");
        expect(broker.runtimeId).toBe("u1::strat::EURUSD::PAPER");
        expect(broker.initialCash).toBe(PAPER_BROKER_DEFAULTS.INITIAL_CASH);
    });

    test("creates LiveBroker for LIVE mode", () => {
        const broker = factory.createBroker(MODES.LIVE, {
            runtimeId: "u1::strat::EURUSD::LIVE",
            symbol: "EURUSD",
            userId: "u1"
        });
        expect(broker).toBeInstanceOf(LiveBroker);
        expect(broker.mode).toBe("PAPER");
        expect(broker.runtimeId).toBe("u1::strat::EURUSD::LIVE");
    });

    test("normalizes lowercase mode strings", () => {
        const broker = factory.createBroker("backtest", {
            runtimeId: "u1::strat::BTCUSD::BACKTEST",
            symbol: "BTCUSD"
        });
        expect(broker).toBeInstanceOf(BacktestBroker);
    });

    test("throws if runtimeId is missing", () => {
        expect(() => factory.createBroker(MODES.BACKTEST, { symbol: "EURUSD" }))
            .toThrow(/runtimeId parameter is strictly required/);
    });

    test("throws for invalid mode", () => {
        expect(() => factory.createBroker("INVALID", { runtimeId: "r1" }))
            .toThrow(/maps to no valid broker module subclass/);
    });

    test("BacktestBroker uses DEFAULT_STRATEGY_CONFIG.INITIAL_CASH when initialCash not provided", () => {
        const broker = factory.createBroker(MODES.BACKTEST, {
            runtimeId: "r1",
            symbol: "EURUSD"
        });
        expect(broker.initialCash).toBe(DEFAULT_STRATEGY_CONFIG.INITIAL_CASH);
    });
});
