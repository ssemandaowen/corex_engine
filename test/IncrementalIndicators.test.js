"use strict";

const ti = require("technicalindicators");
const { IncrementalEMA, IncrementalRSI, IncrementalATR } = require("../utils/strategy/IncrementalIndicators");

describe("Stateful Incremental Indicators (EMA, RSI, ATR)", () => {
    test("EMA incremental update matches technicalindicators batch output", () => {
        const period = 5;
        const prices = [10, 11, 12, 11, 10, 12, 14, 15, 14, 13, 12, 14, 16];
        
        const batchResults = ti.EMA.calculate({ period, values: prices });

        const ema = new IncrementalEMA(period);
        const incrementalResults = [];

        for (let i = 0; i < prices.length; i++) {
            const val = ema.update(prices[i]);
            if (ema.ready) {
                incrementalResults.push(val);
            }
        }

        expect(incrementalResults.length).toBe(batchResults.length);
        for (let i = 0; i < batchResults.length; i++) {
            expect(incrementalResults[i]).toBeCloseTo(batchResults[i], 4);
        }
    });

    test("RSI incremental update matches technicalindicators batch output", () => {
        const period = 4;
        const prices = [10, 11, 12, 11, 10, 12, 14, 15, 14, 13, 12, 14, 16, 17, 18];
        
        const batchResults = ti.RSI.calculate({ period, values: prices });

        const rsi = new IncrementalRSI(period);
        const incrementalResults = [];

        for (let i = 0; i < prices.length; i++) {
            const val = rsi.update(prices[i]);
            if (rsi.ready) {
                incrementalResults.push(val);
            }
        }

        expect(incrementalResults.length).toBe(batchResults.length);
        for (let i = 0; i < batchResults.length; i++) {
            expect(incrementalResults[i]).toBeCloseTo(batchResults[i], 2);
        }
    });

    test("ATR incremental update matches technicalindicators batch output", () => {
        const period = 3;
        const candles = [
            { high: 10, low: 8, close: 9 },
            { high: 11, low: 9, close: 10 },
            { high: 12, low: 10, close: 11 },
            { high: 11, low: 9, close: 10 },
            { high: 13, low: 10, close: 12 },
            { high: 14, low: 11, close: 13 },
        ];
        
        const batchResults = ti.ATR.calculate({
            period,
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            close: candles.map(c => c.close)
        });

        const atr = new IncrementalATR(period);
        const incrementalResults = [];

        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const val = atr.update(c.high, c.low, c.close);
            if (atr.ready) {
                incrementalResults.push(val);
            }
        }

        expect(incrementalResults.length).toBe(batchResults.length);
        for (let i = 0; i < batchResults.length; i++) {
            expect(incrementalResults[i]).toBeCloseTo(batchResults[i], 4);
        }
    });

    test("O(1) update benchmark: update() cost stays flat regardless of history size", () => {
        const period = 10;
        const ema = new IncrementalEMA(period);

        // Warm up
        for (let i = 0; i < 100; i++) ema.update(100 + Math.sin(i));

        const startSmall = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) {
            ema.update(100 + i);
        }
        const durationSmall = Number(process.hrtime.bigint() - startSmall) / 1_000_000;

        // Reset and feed large history before measuring update()
        const emaLarge = new IncrementalEMA(period);
        for (let i = 0; i < 50000; i++) emaLarge.update(100 + Math.sin(i));

        const startLarge = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) {
            emaLarge.update(100 + i);
        }
        const durationLarge = Number(process.hrtime.bigint() - startLarge) / 1_000_000;

        console.log(`[Benchmark] EMA update() time (post 100 updates): ${durationSmall.toFixed(2)}ms`);
        console.log(`[Benchmark] EMA update() time (post 50,000 updates): ${durationLarge.toFixed(2)}ms`);

        // O(1) execution time should be independent of history size (within small margin)
        expect(durationLarge).toBeLessThan(durationSmall * 3.0);
    });

    test("Dynamic re-seeding on period change produces matching value", () => {
        const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 0.5);
        
        // Compute fresh with period 10
        const ema10 = new IncrementalEMA(10);
        prices.forEach(p => ema10.update(p));

        // Reseed existing EMA instance to period 10
        const emaDynamic = new IncrementalEMA(5);
        emaDynamic.period = 10;
        emaDynamic.multiplier = 2 / (10 + 1);
        emaDynamic.reseed(prices);

        expect(emaDynamic.value).toBeCloseTo(ema10.value, 6);
    });
});
