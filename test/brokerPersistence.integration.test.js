const { bus, EVENTS } = require("@events/bus");

jest.mock("@core/services/pgStore", () => ({
    upsertBrokerSettingsForUser: jest.fn(() => Promise.resolve(true))
}));

const pgStore = require("@core/services/pgStore");

// Require brokerPersistence after mocking pgStore so the listener registers
const brokerPersistence = require("@core/services/brokerPersistence");
const PaperBroker = require("@broker/modes/PaperBroker");

describe("Broker persistence integration: method → event → DB", () => {
    let broker;

    beforeEach(() => {
        jest.clearAllMocks();
        // Create a broker with runtimeId and userId set so it can emit properly.
        // We bypass the full constructor by using the prototype pattern like in the unit tests.
        broker = Object.create(PaperBroker.prototype);
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

    test("calling broker.setCash emits event which triggers pgStore upsert", async () => {
        const ok = broker.setCash(500);
        expect(ok).toBe(true);

        // Wait for async event handler to run
        await new Promise((r) => setTimeout(r, 20));

        expect(pgStore.upsertBrokerSettingsForUser).toHaveBeenCalledWith("u1", "paper", expect.objectContaining({ cash: 500 }));
    });

    test("calling broker.setInitialCash emits event which triggers pgStore upsert", async () => {
        const ok = broker.setInitialCash(1000);
        expect(ok).toBe(true);

        await new Promise((r) => setTimeout(r, 20));

        expect(pgStore.upsertBrokerSettingsForUser).toHaveBeenCalledWith("u1", "paper", expect.objectContaining({ initialCash: 1000 }));
    });

    test("calling broker.updateConfig emits event which triggers pgStore upsert", async () => {
        const ok = broker.updateConfig({ spread: 0.5, slippage: 0.1 });
        expect(ok).toBe(true);

        await new Promise((r) => setTimeout(r, 20));

        expect(pgStore.upsertBrokerSettingsForUser).toHaveBeenCalledWith("u1", "paper", expect.objectContaining({ config: expect.objectContaining({ spread: 0.5, slippage: 0.1 }) }));
    });

    test("calling broker.resetAccount emits event which triggers pgStore upsert", async () => {
        broker.resetAccount(200);

        await new Promise((r) => setTimeout(r, 20));

        expect(pgStore.upsertBrokerSettingsForUser).toHaveBeenCalledWith("u1", "paper", expect.objectContaining({ cash: 200 }));
    });

    test("direct call to brokerPersistence.persistBrokerSettings also writes to pgStore", async () => {
        await brokerPersistence.persistBrokerSettings("u2", "live", { cash: 5000 });

        expect(pgStore.upsertBrokerSettingsForUser).toHaveBeenCalledWith("u2", "live", { cash: 5000 });
    });
});
