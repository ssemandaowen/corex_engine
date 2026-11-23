"use strict";

/**
 * Reusable, mutable, normalised market-data frame.
 * load() is the only raw-packet normalisation boundary. It never throws for
 * bad market input: false means the packet was rejected and this frame was
 * left unchanged.
 */
class Frame {
    constructor() {
        this.t = 0;
        this.o = 0;
        this.h = 0;
        this.l = 0;
        this.c = 0;
        this.v = 0;
        this.price = 0;
        this.symbol = "";
        this.hl2 = 0;
        this.hlc3 = 0;
        this.ohlc4 = 0;
    }

    load(packet) {
        if (!packet || typeof packet !== "object") return false;
        try {
            if (packet.time == null || (packet.price == null && packet.close == null)) return false;
            const time = Number(packet.time);
            const rawPrice = packet.price == null ? packet.close : packet.price;
            const price = Number(rawPrice);
            const open = Number(packet.open ?? price);
            const high = Number(packet.high ?? price);
            const low = Number(packet.low ?? price);
            const close = Number(packet.close ?? price);
            const volume = Number(packet.volume ?? 0);
            const symbol = packet.symbol == null ? "" : String(packet.symbol).trim();

            if (![time, price, open, high, low, close, volume].every(Number.isFinite)) return false;
            if (volume < 0 || high < low || open < low || open > high || close < low || close > high) return false;

            this.loadValues(time, open, high, low, close, volume, price, symbol);
            return true;
        } catch (_) {
            return false;
        }
    }

    /** Copy already-normalised typed-array values without allocation. */
    loadValues(time, open, high, low, close, volume, price = close, symbol = this.symbol) {
        this.t = time;
        this.o = open;
        this.h = high;
        this.l = low;
        this.c = close;
        this.v = volume;
        this.price = price;
        this.symbol = symbol;
        this.hl2 = (high + low) / 2;
        this.hlc3 = (high + low + close) / 3;
        this.ohlc4 = (open + high + low + close) / 4;
        return this;
    }

    toPacket() {
        return {
            symbol: this.symbol,
            time: this.t,
            price: this.price,
            open: this.o,
            high: this.h,
            low: this.l,
            close: this.c,
            volume: this.v
        };
    }

    toCandle() {
        return {
            time: this.t,
            open: this.o,
            high: this.h,
            low: this.l,
            close: this.c,
            volume: this.v
        };
    }

    reset() {
        this.loadValues(0, 0, 0, 0, 0, 0, 0, "");
        return this;
    }
}

module.exports = Frame;