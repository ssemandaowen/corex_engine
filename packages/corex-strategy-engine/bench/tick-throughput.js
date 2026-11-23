"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
require("module-alias/register");
const { Strategy } = require("../src/Strategy");

const ITERATIONS = 120_000;
const WARMUP = 12_000;
const RUNS = 3;
const baselinePath = path.join(__dirname, "tick-throughput-baseline.json");

class ThroughputStrategy extends Strategy {
    static indicators = {
        ema: { type: "EMA", period: 14 },
        rsi: { type: "RSI", period: 14 },
        atr: { type: "ATR", period: 14 }
    };

    constructor() {
        super({
            id: "tick-throughput-bench",
            symbols: ["EURUSD"],
            timeframe: "1m",
            candleBased: false,
            lookback: 100,
            max_data_history: 500
        });
    }

    onTick() {}
}

function runOnce() {
    const strategy = new ThroughputStrategy();
    let price = 1.1;
    let time = 0;

    for (let i = 0; i < WARMUP; i++) {
        price += Math.sin(i * 0.01) * 0.00001;
        strategy.onTick({ symbol: "EURUSD", time: time += 1_000, price, volume: 1 });
    }

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        price += Math.sin(i * 0.01) * 0.00001;
        strategy.onTick({ symbol: "EURUSD", time: time += 1_000, price, volume: 1 });
    }
    const elapsedMs = performance.now() - start;
    return elapsedMs / ITERATIONS;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

const samples = [];
for (let i = 0; i < RUNS; i++) samples.push(runOnce());

const medianMsPerTick = median(samples);
const result = {
    iterationsPerRun: ITERATIONS,
    warmupTicksPerRun: WARMUP,
    runs: RUNS,
    runMsPerTick: samples,
    medianMsPerTick,
    medianTicksPerSecond: 1_000 / medianMsPerTick
};

const updateBaseline = process.argv.includes("--write-baseline");
if (updateBaseline) {
    fs.writeFileSync(baselinePath, JSON.stringify(result, null, 2) + "\n", "utf8");
    process.stdout.write("Baseline written: " + baselinePath + "\n");
} else if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const allowed = baseline.medianMsPerTick * 1.05;
    result.baselineMedianMsPerTick = baseline.medianMsPerTick;
    result.regressionLimitMsPerTick = allowed;
    if (medianMsPerTick > allowed) {
        process.stderr.write(JSON.stringify(result, null, 2) + "\n");
        process.stderr.write("FAIL: median tick cost regressed by more than 5% from baseline.\n");
        process.exitCode = 1;
    }
} else {
    process.stdout.write("No benchmark baseline found; run npm run bench -- --write-baseline once.\n");
}

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
