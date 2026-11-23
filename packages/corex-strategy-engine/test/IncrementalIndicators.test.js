"use strict";

const ti = require("technicalindicators");
const IncrementalEMA = require("../src/indicators/ema");
const IncrementalRSI = require("../src/indicators/rsi");
const IncrementalATR = require("../src/indicators/atr");
const Frame = require("../src/kernel/Frame");
const CandleStore = require("../src/kernel/CandleStore");

describe("Stateful Incremental Indicators (EMA, RSI, ATR)", () => {
    test("EMA incremental Frame updates match technicalindicators batch output", () => {
        const period = 5;
        const prices = [10, 11, 12, 11, 10, 12, 14, 15, 14, 13, 12, 14, 16];
        const batchResults = ti.EMA.calculate({ period, values: prices });
        const ema = new IncrementalEMA(period);
        const frame = new Frame();
        const incrementalResults = [];
        for (let i = 0; i < prices.length; i++) {
            const value = prices[i];
            frame.load({ time: i + 1, price: value });
            const result = ema.update(frame);
            if (ema.ready) incrementalResults.push(result);
        }
        expect(incrementalResults.length).toBe(batchResults.length);
        for (let i = 0; i < batchResults.length; i++) expect(incrementalResults[i]).toBeCloseTo(batchResults[i], 4);
    });

    test("RSI legacy scalar update matches technicalindicators batch output", () => {
        const period = 4;
        const prices = [10, 11, 12, 11, 10, 12, 14, 15, 14, 13, 12, 14, 16, 17, 18];
        const batchResults = ti.RSI.calculate({ period, values: prices });
        const rsi = new IncrementalRSI(period);
        const incrementalResults = [];
        for (const price of prices) {
            const value = rsi.update(price);
            if (rsi.ready) incrementalResults.push(value);
        }
        expect(incrementalResults.length).toBe(batchResults.length);
        for (let i = 0; i < batchResults.length; i++) expect(incrementalResults[i]).toBeCloseTo(batchResults[i], 2);
    });

    test("ATR incremental Frame updates match technicalindicators batch output", () => {
        const period = 3;
        const candles = [
            { high: 10, low: 8, close: 9 },
            { high: 11, low: 9, close: 10 },
            { high: 12, low: 10, close: 11 },
            { high: 11, low: 9, close: 10 },
            { high: 13, low: 10, close: 12 },
            { high: 14, low: 11, close: 13 }
        ];
        const batchResults = ti.ATR.calculate({
            period,
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            close: candles.map(c => c.close)
        });
        const atr = new IncrementalATR(period);
        const frame = new Frame();
        const incrementalResults = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            frame.load({ time: i + 1, open: c.close, high: c.high, low: c.low, close: c.close, volume: 1 });
            const value = atr.update(frame);
            if (atr.ready) incrementalResults.push(value);
        }
        expect(incrementalResults.length).toBe(batchResults.length);
        for (let i = 0; i < batchResults.length; i++) expect(incrementalResults[i]).toBeCloseTo(batchResults[i], 4);
    });

    test("O(1) EMA Frame update cost stays flat regardless of history size", () => {
        const period = 10;
        const frame = new Frame();
        const ema = new IncrementalEMA(period);
        for (let i = 0; i < 100; i++) {
            frame.load({ time: i + 1, price: 100 + Math.sin(i) });
            ema.update(frame);
        }
        const startSmall = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) {
            frame.load({ time: i + 101, price: 100 + i });
            ema.update(frame);
        }
        const durationSmall = Number(process.hrtime.bigint() - startSmall) / 1_000_000;

        const emaLarge = new IncrementalEMA(period);
        for (let i = 0; i < 50000; i++) {
            frame.load({ time: i + 1, price: 100 + Math.sin(i) });
            emaLarge.update(frame);
        }
        const startLarge = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) {
            frame.load({ time: i + 50001, price: 100 + i });
            emaLarge.update(frame);
        }
        const durationLarge = Number(process.hrtime.bigint() - startLarge) / 1_000_000;
        expect(durationLarge).toBeLessThan(durationSmall * 3.0);
    });

    test("period reconfiguration plus typed-store replay matches a fresh EMA", () => {
        const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 0.5);
        const store = new CandleStore(128);
        const frame = new Frame();
        const ema10 = new IncrementalEMA(10);
        for (let i = 0; i < prices.length; i++) {
            frame.load({ time: i + 1, price: prices[i] });
            store.pushFrame(frame);
            ema10.update(frame);
        }
        const dynamic = new IncrementalEMA(5);
        dynamic.reconfigure({ period: 10 }, store, new Frame());
        expect(dynamic.value).toBeCloseTo(ema10.value, 12);
    });
});