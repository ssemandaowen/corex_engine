"use strict";

const BacktestDriver = require("../src/drivers/BacktestDriver");
const CoreXPaperDriver = require("../src/drivers/CoreXPaperDriver");
const MetaApiDriver = require("../src/drivers/MetaApiDriver");

describe("BacktestDriver", () => {
    test("extends BaseBroker and has capability flags", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "eur/usd", initialCash: 10000 });
        expect(driver.supports_trading).toBe(true);
        expect(driver.supports_streaming_data).toBe(true);
        expect(driver.symbol).toBe("EURUSD");
    });

    test("submit returns OrderResult with FILLED status", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        driver._ready = true;
        driver._lastPrice = 1.1000;
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 10, OrderType: "MARKET", Side: "BUY" });
        expect(result).toHaveProperty("orderId");
        expect(result).toHaveProperty("status", "FILLED");
        expect(result).toHaveProperty("avgFillPrice");
        expect(result).toHaveProperty("filled", 10);
        expect(result).toHaveProperty("remaining", 0);
        expect(result).toHaveProperty("commission");
        expect(result).toHaveProperty("side", "BUY");
        expect(result).toHaveProperty("symbol", "EURUSD");
    });

    test("submit rejects zero quantity", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        driver._ready = true;
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 0, OrderType: "MARKET", Side: "BUY" });
        expect(result.status).toBe("REJECTED");
    });

    test("submit returns REJECTED if not ready", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 10, OrderType: "MARKET", Side: "BUY" });
        expect(result.status).toBe("REJECTED");
    });

    test("modify throws UnsupportedOperationError", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        await expect(driver.modify("order1", {})).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("cancel throws UnsupportedOperationError", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        await expect(driver.cancel("order1")).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("query_status throws UnsupportedOperationError", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        await expect(driver.query_status("order1")).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("getPosition returns null when no position", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        expect(driver.getPosition("EURUSD")).toBeNull();
    });

    test("getAccount returns correct shape", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        const account = driver.getAccount();
        expect(account).toHaveProperty("balance");
        expect(account).toHaveProperty("equity");
        expect(account).toHaveProperty("currency", "USD");
        expect(account).toHaveProperty("usedMargin");
        expect(account).toHaveProperty("availableMargin");
    });

    test("getEquity returns initialCash with no positions", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        expect(driver.getEquity()).toBe(10000);
    });

    test("onBar updates _lastPrice", async () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        await driver.onBar({ close: 1.1500, time: Date.now() });
        expect(driver._lastPrice).toBe(1.1500);
    });

    test("resetState resets balance and positions", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        driver._ready = true;
        driver._lastPrice = 1.1;
        driver.resetState();
        expect(driver.balance).toBe(10000);
        expect(driver.positions.size).toBe(0);
        expect(driver._lastPrice).toBe(0);
    });

    test("setCash updates balance and returns true", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::strat::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        expect(driver.setCash(5000)).toBe(true);
        expect(driver.balance).toBe(5000);
    });

    test("setCash returns false for negative", () => {
        const driver = new BacktestDriver({ runtimeId: "u1::str::EURUSD::BACKTEST", symbol: "EURUSD", initialCash: 10000 });
        expect(driver.setCash(-100)).toBe(false);
    });
});

describe("CoreXPaperDriver", () => {
    test("extends BaseBroker with correct capability flags", () => {
        const driver = new CoreXPaperDriver({ runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD", initialCash: 10000 });
        expect(driver.supports_trading).toBe(true);
        expect(driver.supports_streaming_data).toBe(true);
        expect(driver.mode).toBe("PAPER");
    });

    test("submit fills market order successfully", async () => {
        const driver = new CoreXPaperDriver({ runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD", initialCash: 10000 });
        driver._ready = true;
        driver._lastPrice = 1.1000;
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 1, OrderType: "MARKET", Side: "BUY", StopLoss: 1.0900, TakeProfit: 1.1100 });
        expect(result.status).toBe("FILLED");
        expect(result.symbol).toBe("EURUSD");
        expect(result.filled).toBe(1);
    });

    test("submit with next_bar fillPolicy returns PENDING", async () => {
        const driver = new CoreXPaperDriver({ runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD", initialCash: 10000, brokerConfig: { fillPolicy: "next_bar" } });
        driver._ready = true;
        driver._lastPrice = 1.1000;
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 1, OrderType: "MARKET", Side: "BUY" });
        expect(result.status).toBe("PENDING");
    });

    test("submit returns REJECTED when no market data", async () => {
        const driver = new CoreXPaperDriver({ runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD", initialCash: 10000 });
        driver._ready = true;
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 1, OrderType: "MARKET", Side: "BUY" });
        expect(result.status).toBe("REJECTED");
    });

    test("modify throws UnsupportedOperationError", async () => {
        const driver = new CoreXPaperDriver({ runtimeId: "r1", symbol: "EURUSD", initialCash: 10000 });
        await expect(driver.modify("order1", {})).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("cancel throws UnsupportedOperationError when no pending orders", async () => {
        const driver = new CoreXPaperDriver({ runtimeId: "r1", symbol: "EURUSD", initialCash: 10000 });
        driver._ready = true;
        await expect(driver.cancel("order1")).rejects.toThrow(/only cancel pending orders/);
    });

    test("getPosition returns null when no position", () => {
        const driver = new CoreXPaperDriver({ runtimeId: "r1", symbol: "EURUSD", initialCash: 10000 });
        expect(driver.getPosition("EURUSD")).toBeNull();
    });

    test("resetState resets balance and clears positions", () => {
        const driver = new CoreXPaperDriver({ runtimeId: "r1", symbol: "EURUSD", initialCash: 10000 });
        driver.resetState();
        expect(driver.balance).toBe(10000);
        expect(driver.positions.size).toBe(0);
    });

    test("resetAccount resets to new balance", () => {
        const driver = new CoreXPaperDriver({ runtimeId: "r1", symbol: "EURUSD", initialCash: 10000 });
        driver.resetAccount(50000);
        expect(driver.balance).toBe(50000);
    });

    test("dataSource is stored for paper mode flexibility", () => {
        const driver = new CoreXPaperDriver({ runtimeId: "r1", symbol: "EURUSD", initialCash: 10000, dataSource: "twelvedata_stream" });
        expect(driver.dataSource).toBe("twelvedata_stream");
    });
});

describe("MetaApiDriver", () => {
    test("constructor loads MetaApiConnector", () => {
        const driver = new MetaApiDriver({ runtimeId: "u1::strat::EURUSD::LIVE", symbol: "EURUSD", userId: "u1" });
        expect(driver.supports_trading).toBe(true);
        expect(driver.supports_streaming_data).toBe(false);
        expect(driver.connector).toBeDefined();
        expect(driver.connector.type).toBe("METAAPI");
    });

    test("submit returns REJECTED when not ready", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 1, OrderType: "MARKET", Side: "BUY" });
        expect(result.status).toBe("REJECTED");
    });

    test("submit forwards to connector and returns FILLED on success", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        driver._ready = true;
        driver._lastPrice = 1.1000;
        const result = await driver.submit({ Symbol: "EURUSD", Volume: 1, OrderType: "MARKET", Side: "BUY", Price: 1.1000 });
        expect(result.status).toBe("FILLED");
        expect(result.symbol).toBe("EURUSD");
    });

    test("modify throws UnsupportedOperationError", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        await expect(driver.modify("order1", {})).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("cancel throws UnsupportedOperationError", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        await expect(driver.cancel("order1")).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("query_status throws UnsupportedOperationError", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        await expect(driver.query_status("order1")).rejects.toBeInstanceOf(require("../src/base/UnsupportedOperationError"));
    });

    test("getEquity returns cached value (0 before initialize)", () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        expect(driver.getEquity()).toBe(0);
    });

    test("refreshState fetches equity from connector and caches it", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        driver.connector.getEquity = async () => 75000;
        await driver.refreshState();
        expect(driver.getEquity()).toBe(75000);
    });

    test("refreshState catches connector errors without throwing", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        driver.connector.getEquity = async () => { throw new Error("503 rate limit exceeded"); };
        await expect(driver.refreshState()).resolves.toBeUndefined();
        expect(driver.getEquity()).toBe(0);
    });

    test("initialize calls refreshState and sets _ready", async () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        driver.connector.getEquity = async () => 50000;
        await driver.initialize({ mode: "LIVE" });
        expect(driver._ready).toBe(true);
        expect(driver.getEquity()).toBe(50000);
    });

    test("setCash returns false (live mode has no local ledger)", () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        expect(driver.setCash(50000)).toBe(false);
    });

    test("setInitialCash returns false (live mode has no local ledger)", () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        expect(driver.setInitialCash(50000)).toBe(false);
    });

    test("resetAccount returns false (live mode has no local ledger)", () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        expect(driver.resetAccount(50000)).toBe(false);
    });

    test("onFill updates cached equity (live push callback)", () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1" });
        driver.onFill({ symbol: "EURUSD", fillPrice: 1.10, fillQty: 10, side: "BUY", commission: 1 });
        expect(driver.getEquity()).toBeCloseTo(-12, 6);
    });

    test("getPositionSnapshot returns frozen object", () => {
        const driver = new MetaApiDriver({ runtimeId: "r1", symbol: "EURUSD", userId: "u1", initialCash: 100000, connectorType: "metaapi" });
        const snap = driver.getPositionSnapshot("EURUSD");
        expect(Object.isFrozen(snap)).toBe(true);
    });
});
