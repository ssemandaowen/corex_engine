"use strict";

class LinearRegressionCurve {
    constructor(period = 14) {
        if (!period || period < 2) throw new Error("LinearRegression period must be >= 2");
        this.period = period;
        this.value = 0;
        this.prev = 0;
        this.ready = false;
        this._buffer = [];
    }

    update(price) {
        this.prev = this.value;
        this._buffer.push(price);
        if (this._buffer.length > this.period) {
            this._buffer.shift();
        }

        if (this._buffer.length === this.period) {
            const n = this.period;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (let i = 0; i < n; i++) {
                const x = i + 1;
                const y = this._buffer[i];
                sumX += x;
                sumY += y;
                sumXY += x * y;
                sumXX += x * x;
            }
            const denominator = n * sumXX - sumX * sumX;
            if (Math.abs(denominator) < 1e-12) {
                this.value = this._buffer[n - 1];
            } else {
                const intercept = (sumY * sumXX - sumX * sumXY) / denominator;
                this.value = intercept;
            }
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

    get slope() {
        if (!this.ready || this._buffer.length < this.period) return 0;
        const n = this.period;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            const x = i + 1;
            const y = this._buffer[i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }
        const denominator = n * sumXX - sumX * sumX;
        if (Math.abs(denominator) < 1e-12) return 0;
        return (n * sumXY - sumX * sumY) / denominator;
    }
}

module.exports = LinearRegressionCurve;