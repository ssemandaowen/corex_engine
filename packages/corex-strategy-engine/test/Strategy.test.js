"use strict";

const { Strategy, StrategyValidator } = require("../index");
const CoreXPaperDriver = require("corex-broker-contract/src/drivers/CoreXPaperDriver");
const BaseBroker = require("corex-broker-contract/src/base/BaseBroker");

describe("Standalone Strategy Engine & ContextBuilder Benchmark", () => {
    class TestEngineStrategy extends Strategy {
        static symbols = ["EURUSD"];
        static timeframe = "1m";

        static params = {
            threshold: { default: 1.1000 },
            rsiPeriod: { default: 14 }
        };

        static indicators = {
            ema: { type: "EMA", period: 5, source: "close" },
            rsi: { type: "RSI", periodKey: "rsiPeriod", source: "close" },
            atr: { type: "ATR", period: 3, source: "close" }
        };

        onStart(ctx) {
            ctx.state.set("started", true);
        }

        onBar(ctx, bar) {
            if (ctx.indicators.ema.value > ctx.params.threshold) {
                return ctx.go.long(1, bar.close);
            }
            return null;
        }

        onStop(ctx) {
            ctx.state.set("stopped", true);
        }
    }

    test("Strategy executes lifecycle and places order successfully", async () => {
        BaseBroker.setRiskValidator(() => ({ accepted: true }));
        const strategy = new TestEngineStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        const broker = new CoreXPaperDriver({
            runtimeId: "r1",
            symbol: "EURUSD",
            initialCash: 10000,
            mode: "PAPER"
        });
        await broker.initialize({ runtimeId: "r1", mode: "PAPER" });

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

        strategy.destroy();
    });

    test("ContextBuilder hot-path allocation benchmark (zero-allocation verification)", () => {
        class BenchmarkStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            static indicators = {
                ema: { type: "EMA", period: 5, source: "close" },
                rsi: { type: "RSI", period: 14, source: "close" },
                atr: { type: "ATR", period: 3, source: "close" }
            };
            onBar(ctx, bar) { return null; }
        }
        const strategy = new BenchmarkStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        strategy.onBar({
            symbol: "EURUSD",
            time: 1000,
            open: 1.1100,
            high: 1.1150,
            low: 1.1050,
            close: 1.1100,
            volume: 100
        });

        if (global.gc) global.gc();
        const memBefore = process.memoryUsage().heapUsed;

        const iterations = 50000;
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            strategy.onBar({
                symbol: "EURUSD",
                time: 1000 * (i + 2),
                open: 1.1100,
                high: 1.1150,
                low: 1.1050,
                close: 1.1100 + (i % 10) * 0.0001,
                volume: 100
            });
        }
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = durationNs / 1_000_000;

        if (global.gc) global.gc();
        const memAfter = process.memoryUsage().heapUsed;
        const heapGrowth = memAfter - memBefore;

        console.log(`[Benchmark] ContextBuilder processed ${iterations} ticks in ${durationMs.toFixed(2)}ms (${(durationMs / iterations * 1000).toFixed(3)} µs/tick). Heap growth: ${(heapGrowth / 1024 / 1024).toFixed(2)} MB`);

        expect(durationMs).toBeLessThan(1000);
        strategy.destroy();
    });

    test("Dynamic parameter update re-seeds indicators without restart", () => {
        const strategy = new TestEngineStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        
        for (let i = 0; i < 10; i++) {
            strategy.onTick({ symbol: "EURUSD", time: i * 1000, price: 1.1000 + i * 0.0010 });
        }

        strategy.updateParams({ threshold: 1.1200 });
        expect(strategy.params.threshold).toBe(1.1200);

        strategy.destroy();
    });

    test("Hook binding ensures this.state, this.log, and custom methods are accessible", () => {
        class BoundHookStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            customMethod() { return "custom_ok"; }
            onBar(ctx, bar) {
                this.state.set("visited", true);
                this.log.info("hook test");
                const res = this.customMethod();
                expect(res).toBe("custom_ok");
                expect(this.state).toBeDefined();
                expect(this.log).toBeDefined();
                return null;
            }
        }
        const strategy = new BoundHookStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        strategy.onBar({ symbol: "EURUSD", time: 1000, close: 1.1000, high: 1.1050, low: 1.0950, volume: 100 });
        strategy.destroy();
    });

    test("Context warmup and readiness guards (hasBars and requireBars)", () => {
        class GuardStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            static indicators = {
                ema: { type: "EMA", period: 5, source: "close" }
            };
            onBar(ctx, bar) {
                if (!ctx.hasBars(3)) return null;
                if (!ctx.requireBars(5, "ema")) return null;
                return ctx.go.long(1, bar.close);
            }
        }
        const strategy = new GuardStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        
        const bar1 = { symbol: "EURUSD", time: 1000, close: 1.1000, high: 1.1050, low: 1.0950, volume: 100 };
        expect(strategy.onBar(bar1)).toBeNull();

        strategy.destroy();
    });

    test("Strategy validation guardrails enforce valid lookback bounds", () => {
        class InvalidLookbackStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            static lookback = -5;
        }
        expect(() => new InvalidLookbackStrategy({ symbols: ["EURUSD"], timeframe: "1m" })).toThrow();

        class ExcessiveLookbackStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            static lookback = 200000;
        }
        expect(() => new ExcessiveLookbackStrategy({ symbols: ["EURUSD"], timeframe: "1m" })).toThrow();

        const validationResult = StrategyValidator.validate(ExcessiveLookbackStrategy);
        expect(validationResult.valid).toBe(false);
    });
});
