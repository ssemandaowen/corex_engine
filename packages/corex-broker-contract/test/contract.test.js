"use strict";

const { BrokerContract, UnsupportedOperationError, STANDARD_METRICS_SHAPE, TRADE_RECORD_SHAPE, ACCOUNT_SNAPSHOT_SHAPE, ORDER_RESULT_SHAPE, STANDARD_ORDER_PAYLOAD } = require("../src/base/BrokerContract");

describe("BrokerContract", () => {
    test("submit throws 'must be implemented' error", async () => {
        const contract = new BrokerContract();
        await expect(contract.submit({ Symbol: "EURUSD", Volume: 1, Side: "BUY" })).rejects.toThrow(/must be implemented/);
    });

    test("modify throws UnsupportedOperationError by default", async () => {
        const contract = new BrokerContract();
        await expect(contract.modify("order123", {})).rejects.toThrow("not supported by this driver");
    });

    test("cancel throws UnsupportedOperationError by default", async () => {
        const contract = new BrokerContract();
        await expect(contract.cancel("order123")).rejects.toThrow("not supported by this driver");
    });

    test("query_status throws UnsupportedOperationError by default", async () => {
        const contract = new BrokerContract();
        await expect(contract.query_status("order123")).rejects.toThrow("not supported by this driver");
    });

    test("initialize throws 'must be implemented' error", async () => {
        const contract = new BrokerContract();
        await expect(contract.initialize({})).rejects.toThrow(/must be implemented/);
    });

    test("resetState throws 'must be implemented' error", () => {
        const contract = new BrokerContract();
        expect(() => contract.resetState()).toThrow(/must be implemented/);
    });

    test("destroy throws 'must be implemented' error", async () => {
        const contract = new BrokerContract();
        await expect(contract.destroy()).rejects.toThrow(/must be implemented/);
    });

    test("onBar throws 'must be implemented' error", async () => {
        const contract = new BrokerContract();
        await expect(contract.onBar({})).rejects.toThrow(/must be implemented/);
    });

    test("onTick is a no-op by default", async () => {
        const contract = new BrokerContract();
        await expect(contract.onTick({ price: 1.1, symbol: "EURUSD" })).resolves.toBeUndefined();
    });

    test("BrokerContract has default capability flags", () => {
        const contract = new BrokerContract();
        expect(contract.supports_trading).toBe(true);
        expect(contract.supports_streaming_data).toBe(false);
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

    test("ORDER_RESULT_SHAPE has all expected fields", () => {
        expect(ORDER_RESULT_SHAPE).toHaveProperty("orderId");
        expect(ORDER_RESULT_SHAPE).toHaveProperty("status");
        expect(ORDER_RESULT_SHAPE).toHaveProperty("avgFillPrice");
        expect(ORDER_RESULT_SHAPE).toHaveProperty("filled");
        expect(ORDER_RESULT_SHAPE).toHaveProperty("remaining");
        expect(ORDER_RESULT_SHAPE).toHaveProperty("commission");
    });

    test("STANDARD_ORDER_PAYLOAD has all expected fields", () => {
        expect(STANDARD_ORDER_PAYLOAD).toHaveProperty("Symbol");
        expect(STANDARD_ORDER_PAYLOAD).toHaveProperty("Volume");
        expect(STANDARD_ORDER_PAYLOAD).toHaveProperty("OrderType");
        expect(STANDARD_ORDER_PAYLOAD).toHaveProperty("StopLoss");
        expect(STANDARD_ORDER_PAYLOAD).toHaveProperty("TakeProfit");
    });

    test("UnsupportedOperationError is the error class used", () => {
        expect(UnsupportedOperationError).toBeDefined();
    });
});
