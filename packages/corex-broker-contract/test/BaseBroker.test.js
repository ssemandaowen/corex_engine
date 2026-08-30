"use strict";

const { bus, EVENTS } = require("@events/bus");
const { BrokerContract, UnsupportedOperationError } = require("../src/base/BrokerContract");
const BaseBroker = require("../src/base/BaseBroker");

class TestBroker extends BaseBroker {
    constructor(config) { super(config); }
    async initialize() {}
    resetState() {}
    async destroy() {}
    async submit() { return { status: "OK", method: "submit" }; }
    async modify() { return { status: "OK", method: "modify" }; }
    async cancel() { return { status: "OK", method: "cancel" }; }
    async query_status() { return { status: "OK", method: "query_status" }; }
    getPosition() { return null; }
    getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
    getAccount() { return { balance: 0, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 }; }
    getEquity() { return 50000; }
    getPerformanceMetrics() { return { trades: [], finalEquity: 50000 }; }
    async onBar() {}
    _emitPortfolioUpdate() {}
}

describe("BaseBroker", () => {
    beforeEach(() => {
        BaseBroker.setRiskValidator(() => ({ accepted: true }));
    });

    afterEach(() => {
        BaseBroker.setRiskValidator(null);
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test("cannot instantiate abstract class directly", () => {
        expect(() => new BaseBroker({ runtimeId: "test" })).toThrow(/Cannot instantiate abstract parent class directly/);
    });

    test("throws if runtimeId is missing", () => {
        expect(() => new TestBroker({})).toThrow(/runtimeId is strictly required/);
    });

    test("validates that subclass implements all required contract methods", () => {
        class IncompleteBroker extends BaseBroker {
            constructor(config) { super(config); }
            async initialize() {}
            resetState() {}
            async destroy() {}
            async submit() {}
            async modify() {}
            async cancel() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getEquity() { return 0; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 0 }; }
            async onBar() {}
        }
        expect(() => new IncompleteBroker({ runtimeId: "r1" })).toThrow(/query_status/);
    });

    test("symbol is normalized at construction", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "eur/usd", initialCash: 100000 });
        expect(broker.symbol).toBe("EURUSD");
        expect(broker.pipScale).toBe(4);
    });

    test("handle() dispatches EXIT via submit with opposite side", async () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        broker._ready = true;
        broker._passesRiskFloor = () => true;
        const result = await broker.handle({ intent: "EXIT", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(result.method).toBe("submit");
    });

    test("handle() dispatches ENTER via placeOrder -> submit", async () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        broker._ready = true;
        broker._passesRiskFloor = () => true;
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(result.method).toBe("submit");
    });

    test("_normalizePayload converts ENTER intent to standard payload", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        const payload = broker._normalizePayload({ intent: "ENTER", symbol: "eur/usd", side: "long", quantity: 10 });
        expect(payload.Symbol).toBe("EURUSD");
        expect(payload.Volume).toBe(10);
        expect(payload.OrderType).toBe("MARKET");
        expect(payload.Side).toBe("BUY");
    });

    test("_normalizePayload converts EXIT intent with opposite side", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        const payload = broker._normalizePayload({ intent: "EXIT", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(payload.Side).toBe("SELL");
    });

    test("handle() returns REJECTED for RISK_FLOOR hit", async () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000, brokerConfig: { riskFloor: 0.5 } });
        broker._ready = true;
        broker._passesRiskFloor = () => false;
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(result.status).toBe("REJECTED");
        expect(result.reason).toBe("RISK_FLOOR");
    });

    test("_passesRiskFloor returns true when no floor configured", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        expect(broker._passesRiskFloor()).toBe(true);
    });

    test("_passesRiskFloor returns true when equity >= floor", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000, brokerConfig: { riskFloor: 0.5 } });
        broker._ready = true;
        expect(broker._passesRiskFloor()).toBe(true);
    });

    test("getMarginStatus calculates correctly", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000, brokerConfig: { leverage: 10 } });
        broker._ready = true;
        broker._lastPrice = 1.10;
        const margin = broker.getMarginStatus();
        expect(margin.leverage).toBe(10);
        expect(margin.equity).toBe(50000);
    });

    test("_checkEntryMargin returns boolean", () => {
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000, brokerConfig: { leverage: 10 } });
        broker._ready = true;
        expect(broker._checkEntryMargin(100, 1.10)).toBe(true);
    });

    test("_emitBrokerState emits BROKER.STATE_CHANGED event", () => {
        const emitSpy = jest.spyOn(bus, "emit");
        const broker = new TestBroker({ runtimeId: "r1", userId: "u1", mode: "PAPER", initialCash: 100000 });
        broker._emitBrokerState({ cash: 50000 });
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({
            userId: "u1",
            mode: "PAPER",
            payload: { cash: 50000 }
        }));
    });

    test("cleanup sets _ready to false", () => {
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        broker._ready = true;
        broker.cleanup();
        expect(broker._ready).toBe(false);
    });

    test("_waitReady resolves when _ready is true", async () => {
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        broker._ready = true;
        await expect(broker._waitReady(100)).resolves.toBeUndefined();
    });

    test("_waitReady rejects after timeout if not ready", async () => {
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        await expect(broker._waitReady(100)).rejects.toThrow(/broker not ready/);
    });

    test("handle() fails closed when no validator is injected", async () => {
        BaseBroker.setRiskValidator(null);
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        broker._ready = true;
        broker._passesRiskFloor = () => true;
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(result.status).toBe("REJECTED");
        expect(result.reason).toBe("RISK_VALIDATOR_NOT_CONFIGURED");
    });

    test("handle() rejects order that exceeds drawdown threshold via real validator", async () => {
        const maxDrawdownThresholdPct = 10.0;
        BaseBroker.setRiskValidator((broker, signal) => {
            const currentEquity = broker.getEquity();
            const initialAllocation = broker.initialCash;
            const currentDrawdownPct = ((initialAllocation - currentEquity) / initialAllocation) * 100;
            if (currentDrawdownPct >= maxDrawdownThresholdPct) return null;
            return { accepted: true, signal };
        });
        const broker = new TestBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        broker._ready = true;
        broker._passesRiskFloor = () => true;
        // TestBroker.getEquity() returns 50000 vs initialCash 100000 = 50% drawdown, exceeds 10% threshold
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(result.status).toBe("REJECTED");
        expect(result.reason).toBe("RISK_LIMIT_EXCEEDED");
    });

    test("handle() passes normal order within limits via real validator", async () => {
        const maxDrawdownThresholdPct = 10.0;
        BaseBroker.setRiskValidator((broker, signal) => {
            const currentEquity = broker.getEquity();
            const initialAllocation = broker.initialCash;
            const currentDrawdownPct = ((initialAllocation - currentEquity) / initialAllocation) * 100;
            if (currentDrawdownPct >= maxDrawdownThresholdPct) return null;
            return { accepted: true, signal };
        });
        class HealthyBroker extends TestBroker {
            getEquity() { return 95000; }
        }
        const broker = new HealthyBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        broker._ready = true;
        broker._passesRiskFloor = () => true;
        // 95000 vs 100000 = 5% drawdown, within 10% threshold
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long", quantity: 10 });
        expect(result.status).toBe("OK");
    });

    test("risk validator adds no meaningful latency to handle()", async () => {
        const maxDrawdownThresholdPct = 10.0;
        BaseBroker.setRiskValidator((broker, signal) => {
            const currentEquity = broker.getEquity();
            const initialAllocation = broker.initialCash;
            const currentDrawdownPct = ((initialAllocation - currentEquity) / initialAllocation) * 100;
            if (currentDrawdownPct >= maxDrawdownThresholdPct) return null;
            return { accepted: true, signal };
        });
        class HealthyBroker extends TestBroker {
            getEquity() { return 95000; }
        }
        const broker = new HealthyBroker({ runtimeId: "r1", symbol: "EURUSD", initialCash: 100000 });
        broker._ready = true;
        broker._passesRiskFloor = () => true;
        const iterations = 10000;
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long", quantity: 10 });
        }
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        const perCall = elapsed / iterations;
        // eslint-disable-next-line no-console
        console.log(`[latency] ${iterations} handle() calls: ${elapsed.toFixed(2)}ms total, ${perCall.toFixed(4)}ms/call`);
        expect(perCall).toBeLessThan(1);
    });
});
