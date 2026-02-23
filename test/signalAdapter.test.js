"use strict";

require("module-alias/register");

const SignalAdapter = require("../engine/signalAdapter");
const db = require("../engine/services/postgres");

describe("SignalAdapter", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test("rejects invalid signal schema", async () => {
        const adapter = new SignalAdapter({ mode: "PAPER", brokers: { PAPER: {} } });
        const result = await adapter.handle({ symbol: "BTC/USD", intent: "ENTER", quantity: 1 });
        expect(result.status).toBe("REJECTED");
        expect(result.reason).toBe("INVALID_SCHEMA");
    });

    test("returns LOCKED when the strategy-symbol key is already processing", async () => {
        jest.spyOn(db, "hasDbConfig").mockReturnValue(false);
        const adapter = new SignalAdapter({ mode: "PAPER", brokers: { PAPER: {} } });
        adapter.processing.add("s1_BTC/USD");

        const locked = await adapter.handle({
            strategyId: "s1",
            symbol: "BTC/USD",
            intent: "ENTER",
            side: "buy",
            quantity: 1
        });
        expect(locked.status).toBe("LOCKED");
    });

    test("live mode persists order with strategy id", async () => {
        jest.spyOn(db, "hasDbConfig").mockReturnValue(true);
        const querySpy = jest.spyOn(db, "query")
            .mockResolvedValueOnce({ rows: [] }) // _resolveMode
            .mockResolvedValueOnce({ rowCount: 1 }); // insert order

        const adapter = new SignalAdapter({ mode: "LIVE" });
        const result = await adapter.handle({
            strategyId: "ema_crossover",
            symbol: "BTC/USD",
            intent: "ENTER",
            side: "BUY",
            quantity: 2
        });

        expect(result.ok).toBe(true);
        expect(result.queued).toBe(true);
        expect(querySpy).toHaveBeenCalledTimes(2);
        const secondCallArgs = querySpy.mock.calls[1][1];
        expect(secondCallArgs[0]).toBe("ema_crossover");
    });

    test("backtest rejects when context missing", async () => {
        jest.spyOn(db, "hasDbConfig").mockReturnValue(false);
        const adapter = new SignalAdapter({ mode: "BACKTEST" });
        const result = await adapter.handle({
            strategyId: "bt",
            symbol: "EUR/USD",
            intent: "ENTER",
            side: "long",
            quantity: 1
        });
        expect(result.status).toBe("REJECTED");
        expect(result.reason).toBe("BACKTEST_CONTEXT_MISSING");
    });

    test("handleSync only allowed in backtest mode", () => {
        const paper = new SignalAdapter({ mode: "PAPER" });
        const rejected = paper.handleSync({
            strategyId: "s",
            symbol: "X",
            intent: "ENTER",
            side: "buy",
            quantity: 1
        });
        expect(rejected.status).toBe("REJECTED");
        expect(rejected.reason).toBe("SYNC_ONLY_BACKTEST");
    });
});
