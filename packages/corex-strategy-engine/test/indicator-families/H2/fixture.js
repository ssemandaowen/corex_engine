"use strict";

const Frame = require("../../../src/kernel/Frame");
const CandleStore = require("../../../src/kernel/CandleStore");

function buildFixture(count = 64) {
    const highs = [];
    const lows = [];
    const closes = [];
    const opens = [];
    for (let i = 0; i < count; i++) {
        const close = 100 + 0.35 * i + 2 * Math.sin(0.71 * i) + 0.8 * Math.cos(0.19 * i);
        const open = close - 0.25 + 0.2 * Math.sin(0.31 * i);
        const high = Math.max(close, open) + 0.7 + 0.1 * (i % 3);
        const low = Math.min(close, open) - 0.6 - 0.1 * (i % 4);
        closes.push(close);
        opens.push(open);
        highs.push(high);
        lows.push(low);
    }
    return { highs, lows, closes, opens };
}

function framesFrom(highs, lows, closes, opens) {
    const frames = [];
    for (let i = 0; i < closes.length; i++) {
        const f = new Frame();
        f.load({
            time: i,
            open: opens[i] !== undefined ? opens[i] : closes[i],
            high: highs[i],
            low: lows[i],
            close: closes[i],
            volume: 1000 + i
        });
        frames.push(f);
    }
    return frames;
}

function storeFrom(frames) {
    const store = new CandleStore(Math.max(1, frames.length));
    for (const frame of frames) store.pushFrame(frame);
    return store;
}

module.exports = { buildFixture, framesFrom, storeFrom };