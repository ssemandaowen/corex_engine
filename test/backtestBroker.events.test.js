const { bus, EVENTS } = require("@events/bus");
const BacktestBrokerClass = require("@broker/modes/BacktestBroker");
const { MetricsAccumulator } = require("@utils/metrics");

describe("BacktestBroker event emissions", () => {
    let broker;
    let emitSpy;

    beforeEach(() => {
        emitSpy = jest.spyOn(bus, "emit");
        // Create a prototype instance to avoid constructor plumbing
        broker = Object.create(BacktestBrokerClass.prototype);
        broker.runtimeId = "r1";
        broker.symbol = "EURUSD";
        broker.userId = "u1";
        broker.mode = "backtest";
        broker.cash = 0;
        broker.initialCash = 10000;
        broker.config = {};
        broker.balance = 10000;
        broker.equity = 10000;
        broker.trades = [];
        broker.positions = new Map();
        broker._lastPrice = 0;
        broker._metrics = new MetricsAccumulator();
        broker._metrics.init(broker.initialCash);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("setCash emits BROKER.STATE_CHANGED", () => {
        const ok = broker.setCash(5000);
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "backtest", payload: expect.objectContaining({ cash: 5000 }) }));
    });

    test("setInitialCash emits BROKER.STATE_CHANGED", () => {
        const ok = broker.setInitialCash(20000);
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "backtest", payload: expect.objectContaining({ initialCash: 20000 }) }));
    });

    test("updateConfig emits BROKER.STATE_CHANGED", () => {
        const ok = broker.updateConfig({ commission: 0.001 });
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "backtest", payload: expect.objectContaining({ config: expect.objectContaining({ commission: 0.001 }) }) }));
    });

    test("resetState emits BROKER.STATE_CHANGED", () => {
        broker.resetState();
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: "backtest", payload: expect.objectContaining({ cash: broker.balance }) }));
    });
});
