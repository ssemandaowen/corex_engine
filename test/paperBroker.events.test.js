const { bus, EVENTS } = require("@events/bus");
const PaperBrokerClass = require("@broker/modes/PaperBroker");

describe("PaperBroker event emissions", () => {
    let broker;
    let emitSpy;

    beforeEach(() => {
        emitSpy = jest.spyOn(bus, "emit");
        // Avoid calling the full constructor (which requires runtime plumbing).
        // Create a prototype instance and set the minimal state required by the methods.
        broker = Object.create(PaperBrokerClass.prototype);
        broker.runtimeId = "r1";
        broker.symbol = "EURUSD";
        broker.userId = "u1";
        broker.mode = "paper";
        broker.cash = 0;
        broker.initialCash = 0;
        broker.config = {};
        broker.trades = [];
        broker.positions = new Map();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("setCash emits BROKER.STATE_CHANGED with cash", () => {
        const ok = broker.setCash(500);
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: broker.mode, payload: expect.objectContaining({ cash: 500 }) }));
    });

    test("setInitialCash emits BROKER.STATE_CHANGED with initialCash", () => {
        const ok = broker.setInitialCash(1000);
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: broker.mode, payload: expect.objectContaining({ initialCash: 1000 }) }));
    });

    test("updateConfig emits BROKER.STATE_CHANGED with config", () => {
        const ok = broker.updateConfig({ foo: "bar" });
        expect(ok).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: broker.mode, payload: expect.objectContaining({ config: expect.objectContaining({ foo: "bar" }) }) }));
    });

    test("resetAccount emits BROKER.STATE_CHANGED with cash and initialCash", () => {
        broker.resetAccount(200);
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.BROKER.STATE_CHANGED, expect.objectContaining({ userId: "u1", mode: broker.mode, payload: expect.objectContaining({ cash: 200 }) }));
    });
});
