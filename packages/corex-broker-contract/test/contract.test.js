"use strict";

const { BrokerContract, STANDARD_METRICS_SHAPE, TRADE_RECORD_SHAPE, ACCOUNT_SNAPSHOT_SHAPE } = require("../src/base/BrokerContract");

describe("BrokerContract", () => {
    test("abstract methods throw 'must be implemented' errors", () => {
        const contract = new BrokerContract();
        const asyncMethods = ["initialize", "placeOrder", "onBar", "destroy"];
        const syncMethods = ["resetState", "getPosition", "getAccount", "getPerformanceMetrics"];

        asyncMethods.forEach((m) => {
            expect(contract[m]("test")).rejects.toThrow(/must be implemented/);
        });

        syncMethods.forEach((m) => {
            expect(() => contract[m]("test")).toThrow(/must be implemented/);
        });
    });

    test("onTick is a no-op by default (optional override)", async () => {
        const contract = new BrokerContract();
        const tick = { time: Date.now(), price: 1.1000, symbol: "EURUSD" };
        await expect(contract.onTick(tick)).resolves.toBeUndefined();
    });

    test("STANDARD_METRICS_SHAPE has all expected keys", () => {
        expect(STANDARD_METRICS_SHAPE).toHaveProperty("netProfit", "number");
        expect(STANDARD_METRICS_SHAPE).toHaveProperty("equityCurve");
        expect(STANDARD_METRICS_SHAPE).toHaveProperty("trades");
    });

    test("TRADE_RECORD_SHAPE has all expected fields", () => {
        expect(TRADE_RECORD_SHAPE).toHaveProperty("entryTime");
        expect(TRADE_RECORD_SHAPE).toHaveProperty("direction");
        expect(TRADE_RECORD_SHAPE).toHaveProperty("commissionPaid");
    });

    test("ACCOUNT_SNAPSHOT_SHAPE has all expected fields", () => {
        expect(ACCOUNT_SNAPSHOT_SHAPE).toHaveProperty("balance");
        expect(ACCOUNT_SNAPSHOT_SHAPE).toHaveProperty("equity");
        expect(ACCOUNT_SNAPSHOT_SHAPE).toHaveProperty("availableMargin");
    });
});
