"use strict";

const { bus, EVENTS } = require("@events/bus");
const { MetricsAccumulator } = require("@utils/metrics");
const BacktestBroker = require("../src/modes/BacktestBroker");
const PaperBroker = require("../src/modes/PaperBroker");
const LiveBroker = require("../src/modes/LiveBroker");
const { MODES } = require("@config/constants");

describe("BacktestBroker", () => {
    test("constructor sets up state correctly", () => {
        const broker = new BacktestBroker({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        expect(broker.initialCash).toBe(10000);
        expect(broker.balance).toBe(10000);
        expect(broker.mode).toBe("PAPER");
        expect(broker.runtimeId).toBe("u1::strat::EURUSD::BACKTEST");
    });

    test("initialize sets _ready to true", async () => {
        const broker = new BacktestBroker({ runtimeId: "u1::strat::EURUSD::BACKTEST" });
        await broker.initialize({ runtimeId: "u1::strat::EURUSD::BACKTEST", mode: "BACKTEST" });
        expect(broker._ready).toBe(true);
    });

    test("execute ENTER reduces balance by trade value", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        const result = broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(result).toBeTruthy();
        expect(result.entryPrice).toBeCloseTo(1.1000, 4);
        expect(broker.balance).toBeCloseTo(10000 - 11.000, 4);
    });

    test("execute EXIT closes position and records metrics", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        const exit = broker.execute({ intent: "EXIT", symbol: "EURUSD" }, { close: 1.1100, time: 2 });
        expect(exit).toBeTruthy();
        expect(exit.type).toBe("FILL_EXIT");
        const metrics = broker.getPerformanceMetrics();
        expect(metrics.totalTrades).toBe(1);
    });

    test("commission is applied on entry", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000, brokerConfig: { commissionPct: 0.1 } });
        broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        const expectedCost = 11.000 + 11.000 * 0.001;
        expect(broker.balance).toBeCloseTo(10000 - expectedCost, 4);
    });

    test("slippage increases long entry price", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000, brokerConfig: { slippageBps: 10 } });
        const result = broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(result.entryPrice).toBeGreaterThan(1.1000);
    });

    test("spread widens long entry price", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000, brokerConfig: { spread: 0.0002 } });
        const result = broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(result.entryPrice).toBeCloseTo(1.1000 + 0.0001, 4);
    });

    test("zero quantity returns null", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        const result = broker.execute({ intent: "ENTER", side: "long", quantity: 0, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(result).toBeNull();
    });

    test("getPosition returns null when no position", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        expect(broker.getPosition("EURUSD")).toBeNull();
    });

    test("getPosition returns position when open", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        const pos = broker.getPosition("EURUSD");
        expect(pos).not.toBeNull();
        expect(pos.quantity).toBe(10);
    });

    test("getAccount returns correct shape", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        const account = broker.getAccount();
        expect(account).toHaveProperty("balance");
        expect(account).toHaveProperty("equity");
        expect(account).toHaveProperty("currency", "USD");
        expect(account).toHaveProperty("usedMargin");
        expect(account).toHaveProperty("availableMargin");
    });

    test("getPositionSnapshot returns frozen snapshot", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        const snap = broker.getPositionSnapshot("EURUSD");
        expect(Object.isFrozen(snap)).toBe(true);
        expect(snap.openCount).toBe(1);
        expect(snap.positions.EURUSD).toBeTruthy();
    });

    test("resetState clears positions and resets balance", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        broker.execute({ intent: "ENTER", side: "long", quantity: 10, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(broker.positions.size).toBe(1);
        broker.resetState();
        expect(broker.positions.size).toBe(0);
        expect(broker.balance).toBe(10000);
    });

    test("setCash updates balance and returns true", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        expect(broker.setCash(5000)).toBe(true);
        expect(broker.balance).toBe(5000);
    });

    test("setCash returns false for negative value", () => {
        const broker = new BacktestBroker({ runtimeId: "r1", initialCash: 10000 });
        expect(broker.setCash(-100)).toBe(false);
    });
});

describe("PaperBroker", () => {
    test("constructor sets up state correctly", () => {
        const broker = new PaperBroker({ runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD", userId: "u1" });
        expect(broker.mode).toBe("PAPER");
        expect(broker.runtimeId).toBe("u1::strat::EURUSD::PAPER");
        expect(broker.userId).toBe("u1");
    });

    test("side 'buy' is normalised to 'long'", async () => {
        const broker = new PaperBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 10000 });
        await broker.initialize({ mode: "PAPER" });
        const entry = await broker.execute({ intent: "ENTER", side: "buy", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(entry.side).toBe("long");
    });

    test("side 'sell' is normalised to 'short'", async () => {
        const broker = new PaperBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 10000 });
        await broker.initialize({ mode: "PAPER" });
        const entry = await broker.execute({ intent: "ENTER", side: "sell", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(entry.side).toBe("short");
    });

    test("trailPct is stored in position record", async () => {
        const broker = new PaperBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 10000 });
        await broker.initialize({ mode: "PAPER" });
        const entry = await broker.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD", trailPct: 2.0 }, { close: 1.1, time: 1 });
        expect(entry.trailPct).toBe(2.0);
        expect(entry.hwm).toBeCloseTo(1.1, 4);
    });

    test("fillPolicy 'next_bar' queues orders", async () => {
        const broker = new PaperBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 10000, brokerConfig: { fillPolicy: "next_bar" } });
        await broker.initialize({ mode: "PAPER" });
        const result = await broker.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(result.status).toBe("PENDING");
    });

    test("resetAccount resets balance and positions", () => {
        const broker = new PaperBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 10000 });
        broker.resetAccount(20000);
        expect(broker.balance).toBe(20000);
    });
});

describe("LiveBroker", () => {
    test("constructor loads MetaApiConnector by default with metaapi", () => {
        const broker = new LiveBroker({ runtimeId: "u1::strat::EURUSD::LIVE", symbol: "EURUSD", userId: "u1", connectorType: "metaapi" });
        expect(broker.connector).toBeDefined();
        expect(broker.connector.type).toBe("METAAPI");
    });

    test("getEquity falls back to cash + unrealized when connector returns 0", () => {
        const broker = new LiveBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        expect(broker.getEquity()).toBeCloseTo(100000, 4);
    });

    test("getPositionSnapshot returns frozen object", () => {
        const broker = new LiveBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        const snap = broker.getPositionSnapshot("EURUSD");
        expect(Object.isFrozen(snap)).toBe(true);
        expect(snap).toHaveProperty("positions");
        expect(snap).toHaveProperty("openCount");
        expect(snap).toHaveProperty("totalUnrealized");
    });

    test("onBar updates _lastPrice from bar.close", () => {
        const broker = new LiveBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        broker.onBar({ close: 1.1500, time: Date.now() });
        expect(broker._lastPrice).toBe(1.1500);
    });

    test("resetState resets cash to initialCash", () => {
        const broker = new LiveBroker({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 50000, connectorType: "metaapi" });
        broker.resetState();
        expect(broker.cash).toBe(50000);
    });
});
