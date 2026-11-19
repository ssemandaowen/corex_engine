"use strict";

const BacktestManager = require("../engine/backtestManager");
const brokerFactory = require("../packages/corex-broker-contract/src/RuntimeBrokerFactory");

describe("HIST-01 canonical strategy identity propagation", () => {
    afterEach(() => {
        brokerFactory.destroyAll();
    });

    test("broker factory carries the database UUID and display name into the paper driver", () => {
        const strategyDbId = "8e5bce74-13f8-4c36-a06a-5b3e9ac3e1a7";
        const broker = brokerFactory.createBroker("PAPER", {
            runtimeId: "u1::Momentum::EURUSD::PAPER",
            symbol: "EURUSD",
            userId: "u1",
            strategyDbId,
            strategyName: "Momentum"
        });

        expect(broker.strategyDbId).toBe(strategyDbId);
        expect(broker.strategyName).toBe("Momentum");
    });

    test("backtest report metadata uses the canonical database UUID and preserves the strategy name", () => {
        const strategyDbId = "8e5bce74-13f8-4c36-a06a-5b3e9ac3e1a7";
        const config = BacktestManager._resolveConfig({
            userId: "u1",
            strategyDbId,
            strategyName: "Momentum",
            symbol: "EURUSD",
            interval: "1h"
        }, { id: "Momentum", name: "Momentum" });

        const meta = BacktestManager._buildMeta(
            "backtest-1",
            { id: "Momentum", name: "Momentum", params: {} },
            config,
            Date.now()
        );

        expect(meta.strategyId).toBe(strategyDbId);
        expect(meta.strategyName).toBe("Momentum");
    });

    test("backtest metadata remains compatible when no database UUID is supplied", () => {
        const config = BacktestManager._resolveConfig({
            userId: "u1",
            symbol: "EURUSD",
            interval: "1h"
        }, { id: "legacy-strategy", name: "Legacy" });

        const meta = BacktestManager._buildMeta(
            "backtest-legacy",
            { id: "legacy-strategy", name: "Legacy", params: {} },
            config,
            Date.now()
        );

        expect(meta.strategyId).toBe("legacy-strategy");
        expect(meta.strategyName).toBe("Legacy");
    });
});