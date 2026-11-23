"use strict";

require("module-alias/register");
const { Strategy } = require("../src/Strategy");

if (typeof global.gc !== "function") {
    throw new Error("Run with --expose-gc (npm run test:memory).");
}

class MemoryStrategy extends Strategy {
    static indicators = {
        ema: { type: "EMA", period: 14 },
        atr: { type: "ATR", period: 14 }
    };

    constructor() {
        super({
            id: "strategy-memory-smoke",
            symbols: ["EURUSD"],
            timeframe: "1m",
            candleBased: false,
            lookback: 100,
            max_data_history: 500
        });
    }

    onTick() {}
}

const strategy = new MemoryStrategy();
let price = 1.1;
let time = 0;

function feed(count) {
    for (let i = 0; i < count; i++) {
        price += Math.sin((time + i) * 0.01) * 0.00001;
        strategy.onTick({
            symbol: "EURUSD",
            time: time += 1_000,
            price,
            volume: 1
        });
    }
}

// Warm the runtime and history before either measurement point.
feed(100_000);
global.gc();
const warmedPointA = process.memoryUsage().heapUsed;

// Exercise the already-warmed hot path again, then compare after a full GC.
feed(100_000);
global.gc();
const warmedPointB = process.memoryUsage().heapUsed;
const growthBytes = warmedPointB - warmedPointA;
const limitBytes = 2 * 1024 * 1024;

const result = {
    warmupTicks: 100_000,
    measuredTicks: 100_000,
    retainedHistoryLimit: strategy.max_data_history,
    warmedPointABytes: warmedPointA,
    warmedPointBBytes: warmedPointB,
    growthBytes,
    growthMiB: Number((growthBytes / 1024 / 1024).toFixed(3)),
    limitBytes
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");

if (growthBytes >= limitBytes) {
    process.stderr.write("FAIL: retained heap growth between warmed points must stay below 2 MiB.\n");
    process.exitCode = 1;
}