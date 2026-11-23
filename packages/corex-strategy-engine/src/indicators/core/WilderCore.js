"use strict";

class WilderCore {
    constructor(period) {
        if (!Number.isInteger(period) || period < 1) throw new TypeError("WilderCore period must be a positive integer");
        this.period = period;
        this.reset();
    }

    reset() {
        this.count = 0;
        this.seedSum = 0;
        this.value = NaN;
        this.ready = false;
        return this;
    }

    update(input) {
        if (!Number.isFinite(input)) return this.value;
        if (!this.ready) {
            this.count += 1;
            this.seedSum += input;
            if (this.count === this.period) {
                this.value = this.seedSum / this.period;
                this.ready = true;
            }
            return this.value;
        }
        this.value = (this.value * (this.period - 1) + input) / this.period;
        this.count += 1;
        return this.value;
    }

    reseed(values) {
        this.reset();
        for (let i = 0; i < values.length; i++) this.update(values[i]);
        return this.value;
    }
}

module.exports = WilderCore;