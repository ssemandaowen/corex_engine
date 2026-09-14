"use strict";

class AccumulationDistribution {
    constructor() {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
    }

    update(high, low, close, volume) {
        this.prev = this.value;
        const range = high - low;
        let moneyFlowMultiplier;
        if (range === 0) {
            moneyFlowMultiplier = 0;
        } else {
            moneyFlowMultiplier = ((close - low) - (high - close)) / range;
        }
        const moneyFlowVolume = moneyFlowMultiplier * volume;
        this.value += moneyFlowVolume;
        this.ready = true;
        return this.value;
    }

    reseed(candles) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close, c.volume);
        }
        return this.value;
    }
}

module.exports = AccumulationDistribution;