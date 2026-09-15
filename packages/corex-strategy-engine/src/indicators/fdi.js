"use strict";

class FractalDimensionIndex {
    static updateMode = "single";
    static resolveParams = (indDef, rp) => [rp ? rp(indDef) : (indDef.period ?? 14)];

    constructor(period = 14) {
        if (!period || period < 1) throw new Error("FDI period must be >= 1");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period + 1) {
            this._buffer.shift();
        }

        if (this._buffer.length >= this.period + 1) {
            const n = this.period;
            const data = this._buffer.slice(-n - 1);

            const maxCount = n / 2;
            const maxCountLog = Math.log10(maxCount);

            let boxSize = (data[n] - data[0]) / maxCount;
            if (Math.abs(boxSize) < 1e-10) {
                this.value = 0;
                this.ready = true;
                return this.value;
            }
            boxSize = Math.abs(boxSize);

            let count = 0;
            let startIdx = 0;
            while (startIdx < n) {
                let endIdx = startIdx + 1;
                let boxStart = data[startIdx];
                let found = true;
                while (found && endIdx <= n) {
                    found = false;
                    for (let i = endIdx; i <= n; i++) {
                        if (data[i] >= boxStart && data[i] < boxStart + boxSize) {
                            endIdx = i + 1;
                            boxStart = data[i];
                            found = true;
                            break;
                        }
                    }
                }
                count++;
                startIdx = endIdx > startIdx ? endIdx - 1 : startIdx + 1;
            }

            this.value = (maxCountLog - Math.log10(count)) / maxCountLog;
            this.ready = true;
        }
        return this.value;
    }

    reseed(values) {
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
        for (let i = 0; i < values.length; i++) {
            this.update(values[i]);
        }
        return this.value;
    }
}

module.exports = FractalDimensionIndex;