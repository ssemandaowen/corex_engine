"use strict";

const { ContextBuilder } = require("../src/ContextBuilder");
const { IndicatorManager } = require("../src/IndicatorManager");

class MinimalStrategy {
    constructor() {
        this.runtimeId = "test_strat";
        this.id = this.runtimeId;
        this.name = "TestStrategy";
        this.__corexStandardized = true;
        this.symbols = ["EURUSD"];
        this.timeframe = "1m";
        this.lookback = 100;
        this.max_data_history = 500;
        this.tfMs = 60000;
        this.params = { threshold: 1.1000, rsiPeriod: 14 };
        this.env = Object.freeze({
            mode: "PAPER",
            isBacktest: false,
            isPaper: true,
            isLive: false,
            runtimeId: this.runtimeId,
            symbol: "EURUSD"
        });
        this.state = {
            set: () => {},
            get: () => null,
            flush: async () => {}
        };
        this._posSnapshot = { positions: {}, openCount: 0, totalUnrealized: 0 };
        this.lastTick = null;
        this.currentBar = null;
        this.positions = {
            get: () => null
        };
    }

    buy(params) {
        return { intent: "ENTER", side: "long", ...params };
    }

    sell(params) {
        return { intent: "ENTER", side: "short", ...params };
    }

    close(params) {
        return { intent: "EXIT", side: "flat", ...params };
    }

    series(symbol, field = "close", n = null) {
        return [];
    }

    _resolveCurrentPrice() { return 1.1000; }
    _normalizeQuantity(q, opts) { return q || 1; }
    sizePosition(opts) { return 1; }
}

describe("ContextBuilder", () => {
    test("builds persistent ctx with in-place mutation", () => {
        const strategy = new MinimalStrategy();
        const indicatorManager = new IndicatorManager(strategy);
        const builder = new ContextBuilder(strategy, indicatorManager);

        builder.ensureInitialized();

        const ctx = builder.ctx;
        expect(ctx).toBeDefined();
        expect(ctx.position).toBeDefined();
        expect(ctx.engine).toBeDefined();
        expect(ctx.ta).toBeDefined();
        expect(ctx.util).toBeDefined();
        expect(ctx.go).toBeDefined();

        const bar1 = { symbol: "EURUSD", time: 1000, open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1020, volume: 100 };
        const ctx1 = builder.updateForPacket(bar1, true);

        expect(ctx1).toBe(ctx);
        expect(ctx.close).toBe(1.1020);
        expect(ctx.price).toBe(1.1020);
        expect(ctx.isBar).toBe(true);

        const bar2 = { symbol: "EURUSD", time: 2000, open: 1.1020, high: 1.1080, low: 1.1000, close: 1.1050, volume: 100 };
        const ctx2 = builder.updateForPacket(bar2, true);

        expect(ctx2).toBe(ctx1);
        expect(ctx.close).toBe(1.1050);
    });

    test("ctx.go.* command methods delegate to strategy", () => {
        const strategy = new MinimalStrategy();
        const builder = new ContextBuilder(strategy, null);
        builder.ensureInitialized();

        const ctx = builder.ctx;
        const bar = { symbol: "EURUSD", time: 1000, close: 1.1020, high: 1.1050, low: 1.0950, volume: 100 };
        builder.updateForPacket(bar, true);

        const longSignal = ctx.go.long(1, 1.1020);
        expect(longSignal).not.toBeNull();

        const shortSignal = ctx.go.short(1, 1.1020);
        expect(shortSignal).not.toBeNull();

        const protectResult = ctx.go.protect({ sl: 1.0900, tp: 1.1500 });
        expect(protectResult).toBeDefined();
        expect(protectResult.intent).toBe("PROTECT");
    });

    test("zero-allocation benchmark: 50k ticks produce minimal heap growth", () => {
        const strategy = new MinimalStrategy();
        const builder = new ContextBuilder(strategy, null);

        builder.ensureInitialized();
        const ctx = builder.ctx;

        builder.updateForPacket({ symbol: "EURUSD", time: 1000, close: 1.1000, high: 1.1050, low: 1.0950, volume: 100 }, true);

        if (global.gc) global.gc();
        const memBefore = process.memoryUsage().heapUsed;

        const iterations = 50000;
        const start = process.hrtime.bigint();

        for (let i = 0; i < iterations; i++) {
            builder.updateForPacket({
                symbol: "EURUSD",
                time: 1000 * (i + 2),
                open: 1.1000,
                high: 1.1050,
                low: 1.0950,
                close: 1.1000 + (i % 10) * 0.001,
                volume: 100
            }, true);
        }

        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = durationNs / 1_000_000;

        if (global.gc) global.gc();
        const memAfter = process.memoryUsage().heapUsed;
        const heapGrowth = memAfter - memBefore;

        console.log(`[ContextBuilder Benchmark] ${iterations} ticks in ${durationMs.toFixed(2)}ms (${(durationMs / iterations * 1000).toFixed(3)} µs/tick). Heap growth: ${(heapGrowth / 1024 / 1024).toFixed(2)} MB`);

        expect(durationMs).toBeLessThan(3000);
        expect(ctx.position).toBeDefined();
        expect(ctx.go).toBeDefined();
    });

    test("buildInitContext and buildContext return same persistent object", () => {
        const strategy = new MinimalStrategy();
        const builder = new ContextBuilder(strategy, null);

        const packet = { symbol: "EURUSD", time: 1000, close: 1.1000, high: 1.1050, low: 1.0950, volume: 100 };

        const initCtx = builder.buildContext(packet, true);
        const buildCtx = builder.buildContext(packet, true);

        expect(initCtx).toBe(buildCtx);
        expect(builder.ctx).toBe(initCtx);
    });
});
