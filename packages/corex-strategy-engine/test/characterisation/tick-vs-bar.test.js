"use strict";

const { captureBarPath, captureTickPath } = require("./paths");
const { Strategy } = require("../../src/Strategy");

describe("tick-fed versus bar-fed indicator parity", () => {
    test("identical closed candles produce identical EMA and ATR sequences", () => {
        const barSamples = captureBarPath();
        const tickSamples = captureTickPath();
        const indicatorState = sample => [sample.ema, sample.atr, sample.emaReady, sample.atrReady];

        expect(tickSamples).toHaveLength(barSamples.length);
        expect(tickSamples.map(indicatorState)).toEqual(barSamples.map(indicatorState));
    });

    test("intrabar onTick receives live ctx.price while indicators advance only on candle close", () => {
        class IntrabarStrategy extends Strategy {
            static indicators = { ema: { type: "EMA", period: 1, source: "close" } };

            constructor() {
                super({
                    id: "intrabar-price-contract",
                    symbols: ["EURUSD"],
                    timeframe: "1m",
                    candleBased: false,
                    lookback: 5,
                    max_data_history: 10
                });
                this.observed = [];
            }

            onTick(ctx) {
                this.observed.push({ price: ctx.price, ema: ctx.indicators.ema.value });
            }
        }

        const strategy = new IntrabarStrategy();
        strategy.onTick({ symbol: "EURUSD", time: 1_000, price: 10, volume: 1 });
        strategy.onTick({ symbol: "EURUSD", time: 2_000, price: 20, volume: 1 });

        expect(strategy.observed.map(sample => sample.price)).toEqual([10, 20]);
        expect(strategy.observed.every(sample => Number.isNaN(sample.ema))).toBe(true);

        strategy.onTick({ symbol: "EURUSD", time: 61_000, price: 30, volume: 1 });
        expect(strategy.observed[2].price).toBe(30);
        expect(strategy.observed[2].ema).toBe(20);
        expect(strategy.dataManager.getLatest("EURUSD")).toEqual({
            time: 0,
            open: 10,
            high: 20,
            low: 10,
            close: 20,
            volume: 2
        });
    });

    test("Frame normalizes non-canonical OHLCV packets and rejects non-finite values", () => {
        class PacketStrategy extends Strategy {
            constructor() {
                super({ id: "packet-normalization", symbols: ["EURUSD"], timeframe: "1m", lookback: 5, max_data_history: 10 });
            }
            onBar() { return null; }
        }
        const strategy = new PacketStrategy();
        strategy.onBar({ symbol: "EURUSD", time: 0, open: "10", high: "12", low: "9", close: "11", volume: "3" });
        expect(strategy.currentBar).toMatchObject({ time: 0, open: 10, high: 12, low: 9, close: 11, volume: 3 });

        const rejected = new PacketStrategy();
        expect(rejected.onBar({ symbol: "EURUSD", time: 0, open: 10, high: NaN, low: 9, close: 11, volume: 3 })).toBeNull();
        expect(rejected.dataManager.getLatest("EURUSD")).toBeNull();
    });

    test("onStart and the data hook share one context update, so the first bar updates indicators once", () => {
        class StartCountStrategy extends Strategy {
            static indicators = { ema: { type: "EMA", period: 3, source: "close" } };

            constructor() {
                super({
                    id: "single-context-update",
                    symbols: ["EURUSD"],
                    timeframe: "1m",
                    candleBased: true,
                    lookback: 5,
                    max_data_history: 10
                });
                this.starts = 0;
                this.bars = 0;
            }

            onStart() { this.starts += 1; }
            onBar() { this.bars += 1; }
        }

        const strategy = new StartCountStrategy();
        strategy.onBar({ symbol: "EURUSD", time: 0, open: 10, high: 10, low: 10, close: 10, volume: 1 });
        expect(strategy.starts).toBe(1);
        expect(strategy.bars).toBe(1);
        const ema = strategy._indicatorManager.getIndicatorValue("ema");
        expect(ema.ready).toBe(false);
        expect(ema.core.count).toBe(1);
        expect(ema.core.seedSum).toBe(10);
    });
});
