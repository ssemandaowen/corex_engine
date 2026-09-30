"use strict";

/**
 * patchParams must persist and broadcast the VALIDATED (coerced) values.
 *
 * The live instance receives coerced params through ParamSchema, so persisting
 * the raw request body would let the database and the running strategy disagree
 * (e.g. "1.5" stored as a string while the live strategy runs 1.5) and the
 * strategy would reload with the wrong type after a restart.
 */

const runtimeService = require("@core/services/runtimeService");
const loader = require("@core/core/loader/StrategyLoader");
const { bus, EVENTS } = require("@events/bus");

const STRATEGY_ID = "user1::CoerceStrat";

function mockMeta() {
    return {
        id: STRATEGY_ID,
        schema: {
            threshold: { type: "number", min: 1.0, max: 2.0, default: 1.1 },
            rsiPeriod: { type: "integer", min: 2, max: 50, default: 14 }
        },
        runtimeParams: { threshold: 1.1, rsiPeriod: 14 }
    };
}

function payloadsFor(spy, event) {
    return spy.mock.calls
        .filter((c) => c[0] === event)
        .map((c) => c[1]);
}

describe("patchParams persists coerced values, not the raw patch", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test("a stringly-typed number is coerced for the DB write and both events", async () => {
        jest.spyOn(loader, "getMeta").mockReturnValue(mockMeta());
        jest.spyOn(loader, "getRuntimes").mockReturnValue([
            { runtimeId: `${STRATEGY_ID}::EURUSD::PAPER`, instance: { updateParams: jest.fn() } }
        ]);
        const saveParamsSpy = jest.spyOn(loader, "saveParams").mockResolvedValue();
        const emitSpy = jest.spyOn(bus, "emit").mockImplementation(() => {});

        const result = await runtimeService.patchParams(STRATEGY_ID, { threshold: "1.5" });
        expect(result.success).toBe(true);

        // Persisted value must be the coerced number, never the raw string.
        expect(saveParamsSpy).toHaveBeenCalledTimes(1);
        const persisted = saveParamsSpy.mock.calls[0][1];
        expect(persisted).toEqual({ threshold: 1.5 });
        expect(typeof persisted.threshold).toBe("number");

        const settings = payloadsFor(emitSpy, EVENTS.SYSTEM.SETTINGS_UPDATED);
        expect(settings).toHaveLength(1);
        expect(settings[0].params).toEqual({ threshold: 1.5 });
        expect(typeof settings[0].params.threshold).toBe("number");

        const paramsUpdated = payloadsFor(emitSpy, EVENTS.STRATEGY.PARAMS_UPDATED);
        expect(paramsUpdated).toHaveLength(1);
        expect(paramsUpdated[0].changed).toEqual({ threshold: 1.5 });
        expect(typeof paramsUpdated[0].changed.threshold).toBe("number");
    });

    test("integer coercion is applied on a stopped strategy too", async () => {
        jest.spyOn(loader, "getMeta").mockReturnValue(mockMeta());
        jest.spyOn(loader, "getRuntimes").mockReturnValue([]);
        const saveParamsSpy = jest.spyOn(loader, "saveParams").mockResolvedValue();
        const emitSpy = jest.spyOn(bus, "emit").mockImplementation(() => {});

        const result = await runtimeService.patchParams(STRATEGY_ID, { rsiPeriod: "21" });
        expect(result.success).toBe(true);

        const persisted = saveParamsSpy.mock.calls[0][1];
        expect(persisted).toEqual({ rsiPeriod: 21 });
        expect(typeof persisted.rsiPeriod).toBe("number");
        expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.STRATEGY.PARAMS_UPDATED, expect.anything());
    });

    test("a multi-key patch coerces every value and drops nothing", async () => {
        jest.spyOn(loader, "getMeta").mockReturnValue(mockMeta());
        jest.spyOn(loader, "getRuntimes").mockReturnValue([]);
        const saveParamsSpy = jest.spyOn(loader, "saveParams").mockResolvedValue();
        jest.spyOn(bus, "emit").mockImplementation(() => {});

        const result = await runtimeService.patchParams(STRATEGY_ID, { threshold: "1.8", rsiPeriod: "9" });
        expect(result.success).toBe(true);
        expect(saveParamsSpy.mock.calls[0][1]).toEqual({ threshold: 1.8, rsiPeriod: 9 });
    });
});
