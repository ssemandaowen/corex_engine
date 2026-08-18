const { bus, EVENTS } = require("@events/bus");

jest.mock("@core/services/pgStore", () => ({
    upsertBrokerSettingsForUser: jest.fn(() => Promise.resolve(true))
}));

const pgStore = require("@core/services/pgStore");

// Require the brokerPersistence module after mocking pgStore so it registers its listener.
const brokerPersistence = require("@core/services/brokerPersistence");

describe("brokerPersistence event wiring", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("emitting EVENTS.BROKER.STATE_CHANGED triggers pgStore.upsertBrokerSettingsForUser", async () => {
        const payload = { userId: "u1", mode: "paper", payload: { cash: 123 } };

        // Emit the event
        bus.emit(EVENTS.BROKER.STATE_CHANGED, payload);

        // Wait briefly for async handler to run
        await new Promise((r) => setTimeout(r, 10));

        expect(pgStore.upsertBrokerSettingsForUser).toHaveBeenCalledWith("u1", "paper", { cash: 123 });
    });
});
