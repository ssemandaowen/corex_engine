"use strict";

const StrategyParamUtils = require("../utils/strategy/StrategyParamUtils");

describe("StrategyParamUtils", () => {
    test("coerces numbers, enforces min/max/step, and applies enums", () => {
        const strat = {
            schema: {
                period: { type: "integer", min: 1, max: 100, step: 5, default: 10 },
                mode: { type: "string", enum: ["FAST", "SLOW"], default: "FAST" }
            },
            params: {},
            log: { info: jest.fn() }
        };
        Object.assign(strat, StrategyParamUtils);
        strat._applyDefaults();
        expect(strat.params.period).toBe(10);
        expect(strat.params.mode).toBe("FAST");

        strat.updateParams({ period: 12 }); // snaps to 10
        expect(strat.params.period).toBe(10);

        strat.updateParams({ period: 13 }); // snaps to 15
        expect(strat.params.period).toBe(15);

        strat.updateParams({ period: 1000 }); // rejected by max
        expect(strat.params.period).toBe(15);

        strat.updateParams({ mode: "NOPE" }); // rejected by enum
        expect(strat.params.mode).toBe("FAST");

        strat.updateParams({ mode: "SLOW" });
        expect(strat.params.mode).toBe("SLOW");
    });

    test("supports string constraints", () => {
        const strat = {
            schema: {
                tag: { type: "string", minLength: 2, maxLength: 4, pattern: "^[A-Z]+$" }
            },
            params: { tag: "OK" },
            log: { info: jest.fn() }
        };
        Object.assign(strat, StrategyParamUtils);

        strat.updateParams({ tag: "a" }); // too short
        expect(strat.params.tag).toBe("OK");

        strat.updateParams({ tag: "ABCDE" }); // too long
        expect(strat.params.tag).toBe("OK");

        strat.updateParams({ tag: "ab" }); // pattern fail
        expect(strat.params.tag).toBe("OK");

        strat.updateParams({ tag: "AB" }); // ok
        expect(strat.params.tag).toBe("AB");
    });
});

