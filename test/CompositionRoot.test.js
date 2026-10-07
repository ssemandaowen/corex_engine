"use strict";

const { createRoot } = require("../engine/kernel/CompositionRoot");
const { createHealth, STATES } = require("../engine/kernel/Health");
const CorexError = require("../utils/CorexError");

describe("engine/kernel/CompositionRoot", () => {
    test("starts components in dependency order and stops in reverse order", async () => {
        const root = createRoot();
        const startOrder = [];
        const stopOrder = [];

        root.register("logger", {
            deps: [],
            start: async () => { startOrder.push("logger"); return { log: () => {} }; },
            stop: async () => { stopOrder.push("logger"); }
        });

        root.register("db", {
            deps: ["logger"],
            start: async () => { startOrder.push("db"); return { query: () => {} }; },
            stop: async () => { stopOrder.push("db"); }
        });

        root.register("server", {
            deps: ["db", "logger"],
            start: async () => { startOrder.push("server"); return { listen: () => {} }; },
            stop: async () => { stopOrder.push("server"); }
        });

        await root.start();

        expect(startOrder).toEqual(["logger", "db", "server"]);
        expect(root.get("logger")).toBeDefined();
        expect(root.get("db")).toBeDefined();
        expect(root.get("server")).toBeDefined();

        await root.stop();

        expect(stopOrder).toEqual(["server", "db", "logger"]);
        expect(root.get("db")).toBeUndefined();
    });

    test("detects dependency cycles and throws DEPENDENCY_CYCLE", async () => {
        const root = createRoot();

        root.register("a", { deps: ["b"] });
        root.register("b", { deps: ["a"] });

        await expect(root.start()).rejects.toThrow(CorexError);
        await expect(root.start()).rejects.toThrow("Dependency cycle detected");
    });

    test("required component failure aborts startup and stops already started components in reverse", async () => {
        const root = createRoot();
        const stopOrder = [];

        root.register("first", {
            deps: [],
            required: true,
            start: async () => "first_instance",
            stop: async () => { stopOrder.push("first"); }
        });

        root.register("second_failing", {
            deps: ["first"],
            required: true,
            start: async () => { throw new Error("Second failed"); }
        });

        await expect(root.start()).rejects.toThrow(CorexError);
        expect(stopOrder).toEqual(["first"]);
        expect(root.get("first")).toBeUndefined();
    });

    test("optional component failure sets health DEGRADED and continues startup", async () => {
        const health = createHealth();
        const root = createRoot({ health });
        const started = [];

        root.register("required_db", {
            deps: [],
            required: true,
            start: async () => { started.push("required_db"); return true; }
        });

        root.register("optional_cache", {
            deps: ["required_db"],
            required: false,
            start: async () => { throw new Error("Redis optional cache down"); }
        });

        root.register("web_server", {
            deps: ["required_db"],
            required: true,
            start: async () => { started.push("web_server"); return true; }
        });

        await root.start();

        expect(started).toEqual(["required_db", "web_server"]);
        expect(health.state()).toBe(STATES.DEGRADED);

        const report = root.report();
        expect(report).toHaveLength(3);
        expect(report[1].name).toBe("optional_cache");
        expect(report[1].status).toBe("failed");
        expect(report[1].error).toBe("Redis optional cache down");
    });
});
