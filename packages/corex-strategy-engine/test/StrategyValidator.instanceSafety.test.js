"use strict";

const { Strategy } = require("../src/Strategy");
const StrategyValidator = require("../src/validation/StrategyValidator");

describe("StrategyValidator instance-safety integration", () => {
    test("reports an unsafe constructor result with a stable diagnostic", () => {
        class ForeignReturningStrategy extends Strategy {
            constructor() {
                super({ symbols: ["BTC/USD"] });
                return {};
            }
        }

        const result = StrategyValidator.validate(ForeignReturningStrategy);
        const issue = result.errors.find((entry) => entry.code === "UNSAFE_STRATEGY_INSTANCE");

        expect(result.valid).toBe(false);
        expect(issue).toBeDefined();
        expect(issue.reason).toBe("PROTOTYPE_MISMATCH");
    });

    test("preserves ordinary validation diagnostics for a validly constructed but invalid strategy", () => {
        class MissingSymbolsStrategy extends Strategy {
            constructor() {
                super({ symbols: ["BTC/USD"] });
                this.symbols = [];
            }
        }

        const result = StrategyValidator.validate(MissingSymbolsStrategy);

        expect(result.valid).toBe(false);
        expect(result.errors.some((entry) => entry.code === "UNSAFE_STRATEGY_INSTANCE")).toBe(false);
        expect(result.errors.some((entry) => entry.code === "EMPTY_SYMBOLS")).toBe(true);
    });
});
