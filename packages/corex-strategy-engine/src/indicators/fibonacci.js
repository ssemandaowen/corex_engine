"use strict";

class FibonacciRetracement {
    static updateMode = "single";
    static resolveParams = () => [];

    constructor() {
        this.levels = [];
        this.ready = false;
    }

    calculate(high, low) {
        const diff = high - low;
        this.levels = [
            { level: 0, price: high },
            { level: 23.6, price: high - diff * 0.236 },
            { level: 38.2, price: high - diff * 0.382 },
            { level: 50, price: high - diff * 0.5 },
            { level: 61.8, price: high - diff * 0.618 },
            { level: 78.6, price: high - diff * 0.786 },
            { level: 100, price: low }
        ];
        this.ready = true;
        return this.levels;
    }

    getLevel(level) {
        const found = this.levels.find(l => l.level === level);
        return found ? found.price : null;
    }

    reseed(candles) {
        if (candles.length === 0) {
            this.levels = [];
            this.ready = false;
            return this.levels;
        }
        let highestHigh = -Infinity;
        let lowestLow = Infinity;
        for (const c of candles) {
            if (c.high > highestHigh) highestHigh = c.high;
            if (c.low < lowestLow) lowestLow = c.low;
        }
        return this.calculate(highestHigh, lowestLow);
    }
}

module.exports = FibonacciRetracement;