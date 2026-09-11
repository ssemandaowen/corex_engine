"use strict";

const RuntimeLifecycle = require("../engine/core/runtime/RuntimeLifecycle");
const runtimeRegistry = require("../engine/core/runtime/RuntimeRegistry");
const BaseStrategy = require("../utils/BaseStrategy");

describe("Symbol-Level Runtime Exclusivity", () => {
    class StratA extends BaseStrategy {
        constructor() { super({ symbols: ["EURUSD"], timeframe: "1m" }); }
    }
    class StratB extends BaseStrategy {
        constructor() { super({ symbols: ["EURUSD"], timeframe: "5m" }); }
    }

    beforeEach(async () => {
        for (const entry of runtimeRegistry.all()) {
            const lifecycle = new RuntimeLifecycle();
            await lifecycle.terminate(entry.runtimeId).catch(() => {});
        }
        runtimeRegistry.clear();
    });

    afterEach(async () => {
        for (const entry of runtimeRegistry.all()) {
            const lifecycle = new RuntimeLifecycle();
            await lifecycle.terminate(entry.runtimeId).catch(() => {});
        }
        runtimeRegistry.clear();
    });

    test("Scenario 1: Two different strategies, same symbol, same account/mode -> second rejected", async () => {
        const lifecycle = new RuntimeLifecycle();
        const strat1 = new StratA();
        const strat2 = new StratB();

        const profile = {
            userId: "acc1",
            accountId: "acc1",
            symbol: "EURUSD",
            mode: "PAPER",
            strategyName: "StratA"
        };

        await lifecycle.boot({
            runtimeId: "acc1::StratA::EURUSD::PAPER",
            strategyInstance: strat1,
            profile
        });

        expect(runtimeRegistry.has("acc1::StratA::EURUSD::PAPER")).toBe(true);

        await expect(lifecycle.boot({
            runtimeId: "acc1::StratB::EURUSD::PAPER",
            strategyInstance: strat2,
            profile: { ...profile, strategyName: "StratB" }
        })).rejects.toThrow(/Exclusivity Violation/);
    });

    test("Scenario 2: Same strategy, same symbol, different timeframes, same account/mode -> second rejected", async () => {
        const lifecycle = new RuntimeLifecycle();
        const strat1 = new StratA();
        const strat2 = new StratB();

        const profile = {
            userId: "acc1",
            accountId: "acc1",
            symbol: "EURUSD",
            mode: "PAPER",
            strategyName: "StratA"
        };

        await lifecycle.boot({
            runtimeId: "acc1::StratA::EURUSD::PAPER",
            strategyInstance: strat1,
            profile
        });

        await expect(lifecycle.boot({
            runtimeId: "acc1::StratA::EURUSD::PAPER_5M",
            strategyInstance: strat2,
            profile: { ...profile, timeframe: "5m" }
        })).rejects.toThrow(/Exclusivity Violation/);
    });

    test("Scenario 3: Same symbol, different accounts -> both succeed", async () => {
        const lifecycle = new RuntimeLifecycle();
        const strat1 = new StratA();
        const strat2 = new StratA();

        await lifecycle.boot({
            runtimeId: "acc1::StratA::EURUSD::PAPER",
            strategyInstance: strat1,
            profile: {
                userId: "acc1",
                accountId: "acc1",
                symbol: "EURUSD",
                mode: "PAPER",
                strategyName: "StratA"
            }
        });

        await expect(lifecycle.boot({
            runtimeId: "acc2::StratA::EURUSD::PAPER",
            strategyInstance: strat2,
            profile: {
                userId: "acc2",
                accountId: "acc2",
                symbol: "EURUSD",
                mode: "PAPER",
                strategyName: "StratA"
            }
        })).resolves.toBe(true);

        expect(runtimeRegistry.size).toBe(2);
    });

    test("Scenario 4: Same symbol, different modes (paper vs live) for same account -> both succeed", async () => {
        const lifecycle = new RuntimeLifecycle();
        const strat1 = new StratA();
        const strat2 = new StratA();

        await lifecycle.boot({
            runtimeId: "acc1::StratA::EURUSD::PAPER",
            strategyInstance: strat1,
            profile: {
                userId: "acc1",
                accountId: "acc1",
                symbol: "EURUSD",
                mode: "PAPER",
                strategyName: "StratA"
            }
        });

        await expect(lifecycle.boot({
            runtimeId: "acc1::StratA::EURUSD::LIVE",
            strategyInstance: strat2,
            profile: {
                userId: "acc1",
                accountId: "acc1",
                symbol: "EURUSD",
                mode: "LIVE",
                strategyName: "StratA"
            }
        })).resolves.toBe(true);

        expect(runtimeRegistry.size).toBe(2);
    });
});
