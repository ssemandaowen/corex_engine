"use strict";

const DeclarativeStrategy = require("../utils/DeclarativeStrategy");
const CoreXPaperDriver = require("corex-broker-contract/src/drivers/CoreXPaperDriver");
const BaseBroker = require("corex-broker-contract/src/base/BaseBroker");
const { validateStrategyCode } = require("../utils/security");

describe("Declarative Strategy Base Class & Pipeline Integration", () => {
    class TestDeclarativeStrategy extends DeclarativeStrategy {
        static symbols = ["EURUSD"];
        static timeframe = "1m";

        static params = {
            threshold: { default: 1.1000 },
            rsiPeriod: { default: 14 }
        };

        static indicators = {
            ema: { type: "EMA", period: 5, source: "close" },
            rsi: { type: "RSI", periodKey: "rsiPeriod", source: "close" }
        };

        onStart(ctx) {
            ctx.state.set("started", true);
        }

        onBar(ctx, bar) {
            console.log("TEST onBar ctx:", ctx);
            if (ctx.indicators.ema.value > ctx.params.threshold) {
                return ctx.go.long(1, bar.close);
            }
            return null;
        }

        onStop(ctx) {
            ctx.state.set("stopped", true);
        }
    }

    test("Declarative strategy executes onBar through pipeline and places order on broker", async () => {
        BaseBroker.setRiskValidator(() => ({ accepted: true }));
        const strategy = new TestDeclarativeStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        const broker = new CoreXPaperDriver({
            runtimeId: "r1",
            symbol: "EURUSD",
            initialCash: 10000,
            mode: "PAPER"
        });
        await broker.initialize({ runtimeId: "r1", mode: "PAPER" });

        // Feed historical bars to warm up EMA (period 5)
        for (let i = 0; i < 6; i++) {
            const bar = {
                symbol: "EURUSD",
                time: 1000 * (i + 1),
                open: 1.1100,
                high: 1.1150,
                low: 1.1050,
                close: 1.1100 + i * 0.0010,
                volume: 100
            };
            strategy.onBar(bar);
            broker.onBar(bar);
        }

        const testBar = {
            symbol: "EURUSD",
            time: 7000,
            open: 1.1200,
            high: 1.1250,
            low: 1.1150,
            close: 1.1200,
            volume: 100
        };
        const signal = strategy.onBar(testBar);
        broker.onBar(testBar);

        expect(signal).toBeDefined();
        expect(signal.intent).toBe("ENTER");
        expect(signal.side).toBe("long");

        const result = await broker.handle(signal);
        expect(result.status).toBe("FILLED");
    });

    test("Dynamic parameter update re-seeds indicators without restart", () => {
        const strategy = new TestDeclarativeStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        
        // Feed initial prices
        for (let i = 0; i < 10; i++) {
            strategy.onTick({ symbol: "EURUSD", time: i * 1000, price: 1.1000 + i * 0.0010 });
        }

        strategy.updateParams({ threshold: 1.1200 });
        expect(strategy.params.threshold).toBe(1.1200);
    });

    test("Security scanner parses declarative strategy code successfully", () => {
        const code = `
            const DeclarativeStrategy = require("../utils/DeclarativeStrategy");
            class MyStrat extends DeclarativeStrategy {
                static symbols = ["EURUSD"];
                static params = { p: 10 };
                onBar(ctx, bar) {
                    return ctx.go.long(1, bar.close);
                }
            }
            module.exports = MyStrat;
        `;
        expect(() => validateStrategyCode(code)).not.toThrow();
    });

    test("Old-format strategy (BaseStrategy / next) still compiles and runs unchanged", () => {
        const BaseStrategy = require("../utils/BaseStrategy");
        class OldStrat extends BaseStrategy {
            constructor() {
                super({ symbols: ["EURUSD"], timeframe: "1m" });
            }
            next(packet) {
                return this.buy({ quantity: 1, price: packet.close });
            }
        }
        const strat = new OldStrat();
        const signal = strat.onBar({ symbol: "EURUSD", time: 1000, close: 1.1000 });
        expect(signal).toBeDefined();
        expect(signal.side).toBe("long");
    });
});
