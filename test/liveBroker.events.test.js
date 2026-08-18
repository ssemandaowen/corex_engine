const { bus, EVENTS } = require("@events/bus");
const LiveBrokerClass = require("@broker/modes/LiveBroker");
const StrategyPositionManager = require("@utils/strategy/StrategyPositionManager");

describe("LiveBroker event emissions", () => {
    let broker;
    let emitSpy;

    beforeEach(() => {
        emitSpy = jest.spyOn(bus, "emit");
        broker = Object.create(LiveBrokerClass.prototype);
        broker.runtimeId = "r1";
        broker.symbol = "EURUSD";
        broker.userId = "u1";
        broker.mode = "live";
        broker.cash = 1000;
        broker.initialCash = 1000;
        broker.config = {};
        broker.positions = new StrategyPositionManager();
        broker._metrics = { recordTrade: jest.fn(), reset: jest.fn(), getSnapshot: jest.fn(() => ({})) };
        broker._persist = jest.fn();
        broker._emitPortfolioUpdate = jest.fn();
        broker.connector = {
            getPositionSnapshot: jest.fn(() => null),
            getEquity: jest.fn(() => 1000),
            disconnect: jest.fn()
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("setCash emits BROKER.STATE_CHANGED", () => {
        const ok = broker.setCash(1500);
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "live", payload: expect.objectContaining({ cash: 1500 }) }));
    });

    test("setInitialCash emits BROKER.STATE_CHANGED", () => {
        const ok = broker.setInitialCash(2000);
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "live", payload: expect.objectContaining({ initialCash: 2000 }) }));
    });

    test("updateConfig emits BROKER.STATE_CHANGED", () => {
        const ok = broker.updateConfig({ riskFloor: 0.2 });
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "live", payload: expect.objectContaining({ config: expect.objectContaining({ riskFloor: 0.2 }) }) }));
    });

    test("resetAccount emits BROKER.STATE_CHANGED", () => {
        broker.resetAccount(1000);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "live", payload: expect.objectContaining({ cash: 1000 }) }));
    });

    test("onFill emits BROKER.STATE_CHANGED with cash update", () => {
        broker.positions.open("EURUSD", "long", 10, 1.1000);
        broker.onFill({ symbol: "EURUSD", fillPrice: 1.1100, fillQty: 10, side: "SELL", commission: 5 });
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "live" }));
        expect(broker._persist).toHaveBeenCalled();
        expect(broker._emitPortfolioUpdate).toHaveBeenCalled();
    });
});
