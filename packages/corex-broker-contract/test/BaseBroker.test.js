"use strict";

const { bus, EVENTS } = require("@events/bus");
const BaseBroker = require("../src/base/BaseBroker");
const { BrokerContract } = require("../src/base/BrokerContract");

describe("BaseBroker", () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test("cannot instantiate abstract class directly", () => {
        expect(() => new BaseBroker({ runtimeId: "test" })).toThrow(/Cannot instantiate abstract parent class directly/);
    });

    test("throws if runtimeId is missing", () => {
        class FakeBroker extends BaseBroker {
            initialize() {}
            resetState() {}
            destroy() {}
            placeOrder() {}
            getPosition() {}
            getAccount() {}
            getPerformanceMetrics() {}
            onBar() {}
        }
        expect(() => new FakeBroker({})).toThrow(/runtimeId is strictly required/);
    });

    test("_validateContractImplementation throws for missing methods", () => {
        class IncompleteBroker extends BaseBroker {
            initialize() {}
            resetState() {}
            destroy() {}
            placeOrder() {}
            getPosition() {}
            getAccount() {}
            onTick() {}
        }
        expect(() => new IncompleteBroker({ runtimeId: "r1" })).toThrow(/BrokerContract violation/);
    });

    test("getAccountSnapshot combines getAccount + getPositionSnapshot", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() {
                return { positions: {}, openCount: 0, totalUnrealized: 0 };
            }
            getAccount() {
                return { balance: 50000, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 };
            }
            getPerformanceMetrics() { return { trades: [], finalEquity: 50000 }; }
            async onBar() {}
        }

        const broker = new TestBroker({ runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD", mode: "PAPER", initialCash: 100000 });
        const snap = broker.getAccountSnapshot();
        expect(snap.balance).toBe(50000);
        expect(snap.mode).toBe("PAPER");
        expect(snap.runtimeId).toBe("u1::strat::EURUSD::PAPER");
        expect(snap.openCount).toBe(0);
        expect(snap).toHaveProperty("positions");
        expect(snap).toHaveProperty("totalUnrealized");
    });

    test("getEquity() throws (must be implemented by subclass)", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 0 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        expect(() => broker.getEquity()).toThrow(/must be implemented/);
    });

    test("execute() throws (must be implemented by subclass)", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 0 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        expect(broker.execute({}, {})).rejects.toThrow(/must be implemented/);
    });

    test("handle() dispatches EXIT to closePosition", async () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() { return { status: "OK", method: "placeOrder" }; }
            async closePosition() { return { status: "OK", method: "closePosition" }; }
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 }; }
            getEquity() { return 50000; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 50000 }; }
            async onBar() {}
            _emitPortfolioUpdate() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        broker._ready = true;
        const result = await broker.handle({ intent: "EXIT", symbol: "EURUSD" });
        expect(result.method).toBe("closePosition");
    });

    test("handle() dispatches non-EXIT to placeOrder", async () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() { return { status: "OK", method: "placeOrder" }; }
            async closePosition() { return { status: "OK", method: "closePosition" }; }
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 }; }
            getEquity() { return 50000; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 50000 }; }
            async onBar() {}
            _emitPortfolioUpdate() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        broker._ready = true;
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long" });
        expect(result.method).toBe("placeOrder");
    });

    test("handle() returns REJECTED for RISK_FLOOR hit", async () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() { return { status: "OK" }; }
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 }; }
            getEquity() { return 100; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 100 }; }
            async onBar() {}
            _emitPortfolioUpdate() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000, brokerConfig: { riskFloor: 0.5 } });
        broker._ready = true;
        const result = await broker.handle({ intent: "ENTER", symbol: "EURUSD", side: "long" });
        expect(result.status).toBe("REJECTED");
        expect(result.reason).toBe("RISK_FLOOR");
    });

    test("_passesRiskFloor returns true when no floor configured", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getEquity() { return 50000; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 0 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        expect(broker._passesRiskFloor()).toBe(true);
    });

    test("getMarginStatus calculates correctly", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() {
                return {
                    positions: { EURUSD: { quantity: 100, entryPrice: 1.10, side: "long" } },
                    openCount: 1,
                    totalUnrealized: 10
                };
            }
            getAccount() { return { balance: 0, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 }; }
            getEquity() { return 50010; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 50010 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000, brokerConfig: { leverage: 10 } });
        const margin = broker.getMarginStatus();
        expect(margin.leverage).toBe(10);
        expect(margin.usedMargin).toBeCloseTo((100 * 1.10) / 10, 6);
        expect(margin.equity).toBe(50010);
        expect(margin.marginLevel).toBeCloseTo((50010 / margin.usedMargin) * 100, 6);
    });

    test("_checkEntryMargin returns correct boolean", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getEquity() { return 100000; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 100000 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000, brokerConfig: { leverage: 10 } });
        expect(broker._checkEntryMargin(100, 1.10)).toBe(true);
    });

    test("_emitBrokerState emits BROKER.STATE_CHANGED event", () => {
        const emitSpy = jest.spyOn(bus, "emit");
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 50000, currency: "USD", usedMargin: 0, availableMargin: 50000 }; }
            getEquity() { return 50000; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 50000 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", userId: "u1", mode: "PAPER", initialCash: 100000 });
        broker._emitBrokerState({ cash: 50000 });
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({
            userId: "u1",
            mode: "PAPER",
            payload: { cash: 50000 }
        }));
    });

    test("cleanup sets _ready to false", () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getEquity() { return 0; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 0 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        broker._ready = true;
        broker.cleanup();
        expect(broker._ready).toBe(false);
    });

    test("_waitReady rejects after timeout if not ready", async () => {
        class TestBroker extends BaseBroker {
            async initialize() {}
            resetState() {}
            async destroy() {}
            async placeOrder() {}
            getPosition() { return null; }
            getPositionSnapshot() { return { positions: {}, openCount: 0, totalUnrealized: 0 }; }
            getAccount() { return { balance: 0, equity: 0, currency: "USD", usedMargin: 0, availableMargin: 0 }; }
            getEquity() { return 0; }
            getPerformanceMetrics() { return { trades: [], finalEquity: 0 }; }
            async onBar() {}
        }
        const broker = new TestBroker({ runtimeId: "r1", initialCash: 100000 });
        await expect(broker._waitReady(100)).rejects.toThrow(/broker not ready/);
    });
});
