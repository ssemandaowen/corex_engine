"use strict";

const { performance, PerformanceObserver } = require("perf_hooks");
const Frame = require("../src/kernel/Frame");
const CandleStore = require("../src/kernel/CandleStore");
const { IndicatorManager } = require("../src/IndicatorManager");
const { globalIndicatorRegistry } = require("../src/IndicatorRegistry");

const BARS_PER_RUN = 200_000;
const WARMUP_BARS = 10_000;
const RUNS_PER_PATH = 7;
const HISTORY_CAPACITY = 1_000;

class BenchStrategy {
    static indicators = {
        sma: { type: "SMA", period: 20 },
        ema: { type: "EMA", period: 20 },
        wma: { type: "WMA", period: 20 },
        hma: { type: "HMA", period: 20 },
        mcginley: { type: "McGinley", period: 20 },
        alma: { type: "ALMA", period: 20 },
        kama: { type: "KAMA", period: 20 },
        vidya: { type: "VIDYA", period: 20 },
        atr: { type: "ATR", period: 20 },
        bands: { type: "BollingerBands", period: 20 },
        stddev: { type: "StandardDeviation", period: 20 },
        donchian: { type: "DonchianChannels", period: 20 },
        keltner: { type: "KeltnerChannels", period: 20 },
        zscore: { type: "ZScore", period: 20 }
    };

    constructor() {
        this.symbols = ["EURUSD"];
        this.params = {};
        this.dataManager = { data: new Map() };
    }
}

function createPipeline() {
    const manager = new IndicatorManager(new BenchStrategy(), globalIndicatorRegistry);
    manager.initialize();
    if (manager.indicatorNames.length < 10) {
        throw new Error("Benchmark requires at least 10 registered indicators.");
    }
    if (manager._legacyEntries.length !== 0) {
        throw new Error("Benchmark indicator set must be fully Frame-based; legacy entries found.");
    }
    return manager;
}

function feed(manager, mode, count, offset = 0) {
    const frame = new Frame();
    const store = new CandleStore(HISTORY_CAPACITY);
    const packet = {
        symbol: "EURUSD",
        time: 0,
        price: 0,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0
    };

    for (let i = 0; i < count; i++) {
        const index = offset + i;
        const close = 1.1 + index * 0.000001 + Math.sin(index * 0.013) * 0.002;
        const open = close - Math.sin(index * 0.031) * 0.0007;
        packet.time = index * 60_000;
        packet.price = close;
        packet.open = open;
        packet.high = Math.max(open, close) + 0.001;
        packet.low = Math.min(open, close) - 0.001;
        packet.close = close;
        packet.volume = 100 + (index % 17) * 3;

        if (!frame.load(packet)) throw new Error("Generated invalid bar at index " + index);
        if (mode === "map") {
            const normalized = frame instanceof Frame ? frame : null;
            if (!normalized) throw new Error("Map benchmark requires a Frame");
            for (const entry of manager._indicators.values()) entry.instance.update(normalized);
            if (manager._legacyEntries.length === 0) {
                store.pushFrame(frame);
                continue;
            }
        } else {
            manager.updateIndicators(frame);
        }
        store.pushFrame(frame);
    }

    let checksum = 0;
    for (const name of manager.indicatorNames) {
        const indicator = manager.getIndicatorValue(name);
        if (Number.isFinite(indicator.value)) checksum += indicator.value;
    }
    return checksum + store.size;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarise(runs) {
    const elapsed = runs.map(run => run.elapsedMs);
    return {
        runs: runs.length,
        minMs: Math.min(...elapsed),
        medianMs: median(elapsed),
        maxMs: Math.max(...elapsed),
        medianBarsPerSecond: Math.round(BARS_PER_RUN / (median(elapsed) / 1000)),
        gcCount: runs.reduce((sum, run) => sum + run.gcCount, 0),
        gcDurationMs: Number(runs.reduce((sum, run) => sum + run.gcDurationMs, 0).toFixed(3)),
        medianHeapGrowthBytes: median(runs.map(run => run.heapGrowthBytes)),
        samples: runs
    };
}

async function runOnce(mode, runIndex) {
    const warm = createPipeline();
    feed(warm, mode, WARMUP_BARS, runIndex * WARMUP_BARS);

    const manager = createPipeline();
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    let gcCount = 0;
    let gcDurationMs = 0;
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            gcCount += 1;
            gcDurationMs += entry.duration;
        }
    });
    observer.observe({ entryTypes: ["gc"] });

    const start = performance.now();
    const checksum = feed(manager, mode, BARS_PER_RUN, runIndex * BARS_PER_RUN);
    const elapsedMs = performance.now() - start;

    if (global.gc) global.gc();
    await new Promise(resolve => setImmediate(resolve));
    for (const entry of observer.takeRecords()) {
        gcCount += 1;
        gcDurationMs += entry.duration;
    }
    observer.disconnect();

    return {
        run: runIndex + 1,
        elapsedMs: Number(elapsedMs.toFixed(3)),
        gcCount,
        gcDurationMs: Number(gcDurationMs.toFixed(3)),
        heapGrowthBytes: process.memoryUsage().heapUsed - heapBefore,
        checksum: Number(checksum.toFixed(8))
    };
}

async function main() {
    if (typeof global.gc !== "function") {
        throw new Error("Run with --expose-gc. The npm bench script supplies this flag.");
    }

    const results = { map: [], dense: [] };
    for (let run = 0; run < RUNS_PER_PATH; run++) {
        const first = run % 2 === 0 ? "map" : "dense";
        const second = first === "map" ? "dense" : "map";
        results[first].push(await runOnce(first, run));
        results[second].push(await runOnce(second, run));
    }

    const output = {
        benchmark: "bar-close indicator dispatch",
        comparison: "legacy Map-backed IndicatorManager entries vs precompiled dense-instance dispatch",
        barsPerRun: BARS_PER_RUN,
        warmupBarsPerPathRun: WARMUP_BARS,
        indicators: Object.keys(BenchStrategy.indicators),
        indicatorCount: Object.keys(BenchStrategy.indicators).length,
        runsPerPath: RUNS_PER_PATH,
        order: "alternating map-first and dense-first",
        map: summarise(results.map),
        dense: summarise(results.dense),
        medianRatioDenseToMap: Number((median(results.dense.map(x => x.elapsedMs)) /
            median(results.map.map(x => x.elapsedMs))).toFixed(4)),
        note: "This isolates dispatch-path cost. It does not establish a whole-engine or indicator-algorithm speedup."
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main().catch(error => {
    process.stderr.write((error && error.stack) || String(error));
    process.stderr.write("\n");
    process.exitCode = 1;
});