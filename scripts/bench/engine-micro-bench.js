"use strict";

require("module-alias/register");

const BaseStrategy = require("@utils/BaseStrategy");

class ArrayShiftQueue {
    constructor() {
        this.items = [];
    }
    get length() { return this.items.length; }
    push(v) { this.items.push(v); }
    shift() { return this.items.shift(); }
}

class PointerQueue {
    constructor() {
        this.items = [];
        this.head = 0;
    }
    get length() { return this.items.length - this.head; }
    push(v) { this.items.push(v); }
    shift() {
        if (this.length <= 0) return undefined;
        const v = this.items[this.head];
        this.head += 1;
        if (this.head > 1024 && this.head * 2 >= this.items.length) {
            this.items = this.items.slice(this.head);
            this.head = 0;
        }
        return v;
    }
}

class BenchStrategy extends BaseStrategy {
    constructor(cfg = {}) {
        super({
            id: "bench_strategy",
            name: "BenchStrategy",
            symbols: cfg.symbols || ["BTC-USD"],
            timeframe: cfg.timeframe || "1m",
            lookback: cfg.lookback || 200,
            max_data_history: cfg.max_data_history || 5000,
            candleBased: cfg.candleBased
        });
    }
    next() { return null; }
}

function toMs(ns) {
    return Number(ns) / 1e6;
}

function pct(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
    return sorted[idx];
}

function benchQueue(QueueType, total = 300000) {
    const q = new QueueType();
    const start = process.hrtime.bigint();
    for (let i = 0; i < total; i++) q.push(i);
    for (let i = 0; i < total; i++) q.shift();
    const ms = toMs(process.hrtime.bigint() - start);
    return {
        total,
        ms,
        opsPerSec: Math.round((total * 2 * 1000) / Math.max(1, ms))
    };
}

function benchTickBurst({ symbols = 8, ticksPerSymbol = 25000, batch = 2000 } = {}) {
    const symbolList = Array.from({ length: symbols }, (_, i) => `SYM${i + 1}`);
    const strategy = new BenchStrategy({ symbols: symbolList, candleBased: false, timeframe: "1m" });
    const latencies = [];
    let price = 100;
    let c = 0;

    const total = symbols * ticksPerSymbol;
    const start = process.hrtime.bigint();
    let batchStart = process.hrtime.bigint();
    for (let i = 0; i < ticksPerSymbol; i++) {
        for (let s = 0; s < symbolList.length; s++) {
            price += ((i + s) % 5 === 0) ? 0.03 : -0.02;
            strategy.onTick({
                symbol: symbolList[s],
                time: Date.now() + i * 1000 + s,
                price,
                volume: 1
            });
            c += 1;
            if (c % batch === 0) {
                const elapsed = toMs(process.hrtime.bigint() - batchStart);
                latencies.push(elapsed / batch);
                batchStart = process.hrtime.bigint();
            }
        }
    }
    const ms = toMs(process.hrtime.bigint() - start);
    const sorted = latencies.slice().sort((a, b) => a - b);
    return {
        total,
        ms,
        ticksPerSec: Math.round((total * 1000) / Math.max(1, ms)),
        avgTickMs: ms / total,
        p50TickMs: pct(sorted, 50),
        p95TickMs: pct(sorted, 95)
    };
}

function benchWarmupReplay({ bars = 120000, symbols = 4 } = {}) {
    const symbolList = Array.from({ length: symbols }, (_, i) => `WARM${i + 1}`);
    const strategy = new BenchStrategy({ symbols: symbolList, candleBased: true, timeframe: "1m", lookback: 500 });
    const start = process.hrtime.bigint();

    let t = Date.now() - (bars * 60000);
    let price = 250;
    for (let i = 0; i < bars; i++) {
        const sym = symbolList[i % symbolList.length];
        price += (i % 2 === 0 ? 0.1 : -0.07);
        strategy.onTick({
            symbol: sym,
            time: t,
            open: price - 0.2,
            high: price + 0.4,
            low: price - 0.5,
            close: price,
            price,
            volume: 10
        });
        t += 60000;
    }
    const ms = toMs(process.hrtime.bigint() - start);
    return {
        totalBars: bars,
        ms,
        barsPerSec: Math.round((bars * 1000) / Math.max(1, ms)),
        avgBarMs: ms / bars
    };
}

function printSection(title, payload) {
    console.log(`\n=== ${title} ===`);
    Object.entries(payload).forEach(([k, v]) => {
        console.log(`${k}: ${typeof v === "number" ? Number(v.toFixed(4)) : v}`);
    });
}

function main() {
    const queueOps = Number(process.env.BENCH_QUEUE_OPS || 300000);
    const tickSymbols = Number(process.env.BENCH_TICK_SYMBOLS || 8);
    const tickPerSymbol = Number(process.env.BENCH_TICKS_PER_SYMBOL || 25000);
    const warmBars = Number(process.env.BENCH_WARMUP_BARS || 120000);

    console.log("CoreX Micro-benchmark");
    console.log(`Node: ${process.version}`);
    console.log(`Memory rss(MB): ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)}`);

    const queueShift = benchQueue(ArrayShiftQueue, queueOps);
    const queuePointer = benchQueue(PointerQueue, queueOps);
    const tickBurst = benchTickBurst({ symbols: tickSymbols, ticksPerSymbol: tickPerSymbol });
    const warmup = benchWarmupReplay({ bars: warmBars, symbols: Math.min(8, tickSymbols) });

    printSection("Queue (Array.shift baseline)", queueShift);
    printSection("Queue (Pointer queue current)", queuePointer);
    printSection("Tick Burst (Strategy.onTick)", tickBurst);
    printSection("Warmup Replay (bar ingest path)", warmup);

    const queueGainPct = ((queueShift.ms - queuePointer.ms) / Math.max(1, queueShift.ms)) * 100;
    console.log(`\nQueue speedup vs shift baseline: ${queueGainPct.toFixed(2)}%`);
}

main();

