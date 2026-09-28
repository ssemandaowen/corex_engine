"use strict";

const runtimeService = require("@core/services/runtimeService");
const loader = require("@core/core/loader/StrategyLoader");
const { bus, EVENTS } = require("@events/bus");

describe("RuntimeService patchParams schema validation integration", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("patchParams rejects invalid patch, avoids DB write and does not emit events", async () => {
        const mockMeta = {
            id: "user1::TestStrat",
            schema: {
                threshold: { type: "number", min: 1.0, max: 2.0, default: 1.1 }
            },
            runtimeParams: { threshold: 1.1 }
        };
        
        jest.spyOn(loader, "getMeta").mockReturnValue(mockMeta);
        jest.spyOn(loader, "getRuntimes").mockReturnValue([]);
        const saveParamsSpy = jest.spyOn(loader, "saveParams").mockResolvedValue();
        const emitSpy = jest.spyOn(bus, "emit");

        const result = await runtimeService.patchParams("user1::TestStrat", { threshold: 5.0 });
        expect(result.success).toBe(false);
        expect(result.error).toBe("VALIDATION_FAILED");
        expect(result.errors.threshold).toBeDefined();

        expect(saveParamsSpy).not.toHaveBeenCalled();
        expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.SYSTEM.SETTINGS_UPDATED, expect.any(Object));
        expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.STRATEGY.PARAMS_UPDATED, expect.any(Object));
    });

    test("patchParams with valid patch writes to DB and emits events when runtimes active", async () => {
        const mockMeta = {
            id: "user1::TestStrat",
            schema: {
                threshold: { type: "number", min: 1.0, max: 2.0, default: 1.1 }
            },
            runtimeParams: { threshold: 1.1 }
        };
        const mockInstance = {
            updateParams: jest.fn()
        };
        const mockRuntime = {
            runtimeId: "user1::TestStrat::EURUSD::PAPER",
            instance: mockInstance
        };
        
        jest.spyOn(loader, "getMeta").mockReturnValue(mockMeta);
        jest.spyOn(loader, "getRuntimes").mockReturnValue([mockRuntime]);
        const saveParamsSpy = jest.spyOn(loader, "saveParams").mockResolvedValue();
        const emitSpy = jest.spyOn(bus, "emit");

        const result = await runtimeService.patchParams("user1::TestStrat", { threshold: 1.5 });
        expect(result.success).toBe(true);
        expect(saveParamsSpy).toHaveBeenCalledWith("user1::TestStrat", { threshold: 1.5 });
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.SYSTEM.SETTINGS_UPDATED, expect.objectContaining({ id: "user1::TestStrat" }));
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.STRATEGY.PARAMS_UPDATED, expect.objectContaining({ strategyId: "user1::TestStrat" }));
    });

    test("patchParams on stopped strategy (no active runtimes) validates and saves to DB", async () => {
        const mockMeta = {
            id: "user1::TestStrat",
            schema: {
                threshold: { type: "number", min: 1.0, max: 2.0, default: 1.1 }
            },
            runtimeParams: { threshold: 1.1 }
        };
        
        jest.spyOn(loader, "getMeta").mockReturnValue(mockMeta);
        jest.spyOn(loader, "getRuntimes").mockReturnValue([]);
        const saveParamsSpy = jest.spyOn(loader, "saveParams").mockResolvedValue();
        const emitSpy = jest.spyOn(bus, "emit");

        const result = await runtimeService.patchParams("user1::TestStrat", { threshold: 1.8 });
        expect(result.success).toBe(true);
        expect(saveParamsSpy).toHaveBeenCalledWith("user1::TestStrat", { threshold: 1.8 });
        expect(emitSpy).not.toHaveBeenCalled();
    });
});
