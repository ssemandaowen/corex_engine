"use strict";

const SharedFillSim = require("../src/utils/SharedFillSim");

describe("SharedFillSim", () => {
    test("calculateCommission returns 0 when commissionPct is 0", () => {
        const sim = new SharedFillSim({ commissionPct: 0 });
        expect(sim.calculateCommission(10000)).toBe(0);
    });

    test("calculateCommission applies percentage correctly", () => {
        const sim = new SharedFillSim({ commissionPct: 0.1 });
        expect(sim.calculateCommission(10000)).toBe(10);
    });

    test("calculateSlippage returns 0 when slippageBps is 0", () => {
        const sim = new SharedFillSim({ slippageBps: 0 });
        expect(sim.calculateSlippage({ close: 1.1 }, "long")).toBe(0);
    });

    test("calculateSlippage applies BPS correctly for long", () => {
        const sim = new SharedFillSim({ slippageBps: 10 });
        const result = sim.calculateSlippage({ close: 1.1000 }, "long");
        expect(result).toBeCloseTo(0.0011, 6);
    });

    test("calculateSlippage is negative for short", () => {
        const sim = new SharedFillSim({ slippageBps: 10 });
        const result = sim.calculateSlippage({ close: 1.1000 }, "short");
        expect(result).toBeCloseTo(-0.0011, 6);
    });

    test("calculateSlippage uses ATR when useATR is true", () => {
        const sim = new SharedFillSim({ slippageBps: 10, useATR: true });
        const result = sim.calculateSlippage({ close: 1.1000, atr: 0.0010 }, "long");
        expect(result).toBeCloseTo(0.000001, 9);
    });

    test("fillMarketOrder returns null for zero quantity", () => {
        const sim = new SharedFillSim();
        const result = sim.fillMarketOrder({ symbol: "EURUSD", side: "long", quantity: 0 }, { close: 1.1 });
        expect(result).toBeNull();
    });

    test("fillMarketOrder returns FILLED result for valid market order", () => {
        const sim = new SharedFillSim();
        const bar = { close: 1.1000, time: 1 };
        const result = sim.fillMarketOrder({ symbol: "EURUSD", side: "long", quantity: 10 }, bar);
        expect(result.status).toBe("FILLED");
        expect(result.filled).toBe(10);
        expect(result.remaining).toBe(0);
    });

    test("fillMarketOrder normalizes side correctly for short", () => {
        const sim = new SharedFillSim();
        const bar = { close: 1.1000, time: 1 };
        const result = sim.fillMarketOrder({ symbol: "EURUSD", side: "short", quantity: 10 }, bar);
        expect(result.side).toBe("short");
    });

    test("fillMarketOrder applies slippage for long (price increases)", () => {
        const sim = new SharedFillSim({ slippageBps: 10 });
        const bar = { close: 1.1000, time: 1 };
        const result = sim.fillMarketOrder({ symbol: "EURUSD", side: "long", quantity: 10 }, bar);
        expect(result.avgFillPrice).toBeGreaterThan(1.1000);
    });

    test("fillLimitOrder returns PENDING when price not in range", () => {
        const sim = new SharedFillSim();
        const bar = { open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1020, time: 1 };
        const result = sim.fillLimitOrder({ symbol: "EURUSD", side: "long", quantity: 10, price: 1.0900, orderType: "LIMIT" }, bar);
        expect(result.status).toBe("PENDING");
        expect(result.filled).toBe(0);
    });

    test("fillLimitOrder returns FILLED when price is in range", () => {
        const sim = new SharedFillSim();
        const bar = { open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1020, time: 1 };
        const result = sim.fillLimitOrder({ symbol: "EURUSD", side: "long", quantity: 10, price: 1.1000, orderType: "LIMIT" }, bar);
        expect(result.status).toBe("FILLED");
        expect(result.filled).toBe(10);
    });

    test("fillStopOrder returns PENDING when stop not triggered", () => {
        const sim = new SharedFillSim();
        const bar = { open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1020, time: 1 };
        const result = sim.fillStopOrder({ symbol: "EURUSD", side: "long", quantity: 10, stopPrice: 1.1100, orderType: "STOP" }, bar);
        expect(result.status).toBe("PENDING");
        expect(result.filled).toBe(0);
    });

    test("fillStopOrder returns FILLED when stop is triggered (long)", () => {
        const sim = new SharedFillSim();
        const bar = { open: 1.1000, high: 1.1150, low: 1.0950, close: 1.1100, time: 1 };
        const result = sim.fillStopOrder({ symbol: "EURUSD", side: "long", quantity: 10, stopPrice: 1.1100, orderType: "STOP" }, bar);
        expect(result.status).toBe("FILLED");
        expect(result.filled).toBe(10);
    });

    test("fillStopOrder returns FILLED when stop is triggered (short)", () => {
        const sim = new SharedFillSim();
        const bar = { open: 1.1000, high: 1.1100, low: 1.0850, close: 1.0900, time: 1 };
        const result = sim.fillStopOrder({ symbol: "EURUSD", side: "short", quantity: 10, stopPrice: 1.0900, orderType: "STOP" }, bar);
        expect(result.status).toBe("FILLED");
        expect(result.filled).toBe(10);
    });

    test("execute dispatches to correct fill method based on OrderType", () => {
        const sim = new SharedFillSim();
        const bar = { close: 1.1000, time: 1 };
        const marketResult = sim.execute({ symbol: "EURUSD", side: "long", quantity: 10, orderType: "MARKET" }, bar);
        expect(marketResult.status).toBe("FILLED");
    });

    test("execute returns REJECTED for unknown order type", () => {
        const sim = new SharedFillSim();
        const bar = { close: 1.1000, time: 1 };
        const result = sim.execute({ symbol: "EURUSD", side: "long", quantity: 10, orderType: "UNKNOWN" }, bar);
        expect(result.status).toBe("REJECTED");
    });

    test("resetState preserves config", () => {
        const sim = new SharedFillSim({ commissionPct: 0.1, slippageBps: 10 });
        sim.resetState();
        expect(sim.commissionPct).toBe(0.1);
        expect(sim.slippageBps).toBe(10);
    });
});
