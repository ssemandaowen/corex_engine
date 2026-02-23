"use strict";

require("module-alias/register");

const { StrategyContract } = require("../engine/core/strategy/StrategyContract");
const { StrategyCompiler } = require("../engine/services/strategyCompiler");

describe("StrategyContract", () => {
    test("adapts legacy strategy hooks into contract methods", () => {
        const legacy = {
            symbol: "BTC/USD",
            onTick: jest.fn(() => ({ strategyId: "s1", symbol: "BTC/USD", intent: "ENTER" }))
        };

        const before = StrategyContract.validate(legacy);
        expect(before.ok).toBe(false);

        StrategyContract.adapt(legacy);
        const after = StrategyContract.validate(legacy);
        expect(after.ok).toBe(true);
        expect(typeof legacy.generateSignal).toBe("function");
        expect(typeof legacy.onMarketData).toBe("function");
        expect(typeof legacy.getStateSnapshot).toBe("function");
    });
});

describe("StrategyCompiler", () => {
    test("compiles strategy and applies contract adaptation", async () => {
        const compiler = new StrategyCompiler();
        const code = `
            module.exports = class DemoStrategy {
                constructor() {
                    this.symbols = ["BTC/USD"];
                    this.timeframe = "1m";
                }
                onTick(packet) {
                    return { strategyId: "demo", symbol: packet.symbol || "BTC/USD", intent: "ENTER", side: "long", quantity: 1 };
                }
            };
        `;

        const result = await compiler.compile(code, "demo");
        expect(result.success).toBe(true);
        expect(result.instance).toBeTruthy();
        expect(typeof result.instance.generateSignal).toBe("function");
        expect(typeof result.instance.getStateSnapshot).toBe("function");
    });

    test("rejects strategies that do not satisfy contract/method requirements", async () => {
        const compiler = new StrategyCompiler();
        const code = `
            module.exports = class InvalidStrategy {
                constructor() {
                    this.symbols = ["BTC/USD"];
                }
            };
        `;

        const result = await compiler.compile(code, "invalid");
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain("Missing required method");
    });
});
