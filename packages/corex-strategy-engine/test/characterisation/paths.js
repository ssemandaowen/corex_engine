"use strict";

require("module-alias/register");
const { Strategy } = require("../../src/Strategy");

const BARS = Object.freeze([
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 },
    { time: 60_000, open: 13, high: 14, low: 12, close: 13.5, volume: 120 },
    { time: 120_000, open: 12, high: 15, low: 11, close: 14, volume: 130 },
    { time: 180_000, open: 16, high: 17, low: 15, close: 16.5, volume: 140 },
    { time: 240_000, open: 15, high: 18, low: 14, close: 17, volume: 150 },
    { time: 300_000, open: 19, high: 20, low: 18, close: 19.5, volume: 160 }
]);

class CharacterisationStrategy extends Strategy {
    static indicators = {
        ema: { type: "EMA", period: 3, source: "close" },
        atr: { type: "ATR", period: 3 }
    };

    constructor() {
        super({
            id: "characterisation-path",
            name: "CharacterisationPath",
            symbols: ["EURUSD"],
            timeframe: "1m",
            candleBased: true,
            lookback: 10,
            max_data_history: 20
        });
        this.samples = [];
    }

    onBar(ctx) {
        this.samples.push(captureSample(ctx, this));
    }

    onTick(ctx) {
        this.samples.push(captureSample(ctx, this));
    }
}

function captureSample(ctx, strategy) {
    return {
        time: ctx.time,
        isBar: ctx.isBar,
        price: ctx.price,
        close: ctx.close,
        ema: Number.isFinite(ctx.indicators.ema.value) ? ctx.indicators.ema.value : null,
        emaReady: ctx.indicators.ema.ready,
        atr: Number.isFinite(ctx.indicators.atr.value) ? ctx.indicators.atr.value : null,
        atrReady: ctx.indicators.atr.ready,
        storedBars: strategy.dataManager.getLookbackWindow("EURUSD").length
    };
}

function captureBarPath() {
    const strategy = new CharacterisationStrategy();
    for (const bar of BARS) {
        strategy.onBar({ symbol: "EURUSD", ...bar });
    }
    return strategy.samples;
}

function makeTicks() {
    const ticks = [];
    for (const bar of BARS) {
        const points = [
            { offset: 1_000, price: bar.open },
            { offset: 2_000, price: bar.high },
            { offset: 3_000, price: bar.low },
            { offset: 4_000, price: bar.close }
        ];
        for (const point of points) {
            ticks.push({
                symbol: "EURUSD",
                time: bar.time + point.offset,
                price: point.price,
                volume: bar.volume / points.length
            });
        }
    }
    ticks.push({
        symbol: "EURUSD",
        time: BARS.length * 60_000 + 1_000,
        price: BARS[BARS.length - 1].close + 0.5,
        volume: 0
    });
    return ticks;
}

function captureTickPath() {
    const strategy = new CharacterisationStrategy();
    for (const tick of makeTicks()) strategy.onTick(tick);
    return strategy.samples;
}

module.exports = {
    BARS,
    CharacterisationStrategy,
    captureBarPath,
    captureTickPath
};
