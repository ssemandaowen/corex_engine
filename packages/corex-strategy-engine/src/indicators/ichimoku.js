"use strict";

class IchimokuCloud {
    static updateMode = "multi";
    static resolveParams = (indDef) => [Number(indDef.conversion || 9), Number(indDef.base || 26), Number(indDef.lagging || 52), Number(indDef.displacement || 26)];

    constructor(conversionPeriod = 9, basePeriod = 26, laggingPeriod = 52, cloudDisplacement = 26) {
        if (!conversionPeriod || conversionPeriod < 1) throw new Error("Ichimoku conversionPeriod must be >= 1");
        if (!basePeriod || basePeriod < 1) throw new Error("Ichimoku basePeriod must be >= 1");
        if (!laggingPeriod || laggingPeriod < 1) throw new Error("Ichimoku laggingPeriod must be >= 1");
        if (!cloudDisplacement || cloudDisplacement < 1) throw new Error("Ichimoku cloudDisplacement must be >= 1");
        this.conversionPeriod = conversionPeriod;
        this.basePeriod = basePeriod;
        this.laggingPeriod = laggingPeriod;
        this.cloudDisplacement = cloudDisplacement;
        this.tenkan = 0;
        this.kijun = 0;
        this.senkouA = 0;
        this.senkouB = 0;
        this.chikou = 0;
        this.cloudUpper = 0;
        this.cloudLower = 0;
        this.ready = false;
        this._buffer = [];
        this._chikouBuffer = [];
    }

    update(high, low, close) {
        this._buffer.push({ high, low, close });
        if (this._buffer.length > this.laggingPeriod) {
            this._buffer.shift();
        }

        this._chikouBuffer.push(close);
        if (this._chikouBuffer.length > this.cloudDisplacement + 1) {
            this._chikouBuffer.shift();
        }

        if (this._buffer.length >= this.conversionPeriod) {
            const recentConv = this._buffer.slice(-this.conversionPeriod);
            let maxHigh = -Infinity;
            let minLow = Infinity;
            for (const c of recentConv) {
                if (c.high > maxHigh) maxHigh = c.high;
                if (c.low < minLow) minLow = c.low;
            }
            this.tenkan = (maxHigh + minLow) / 2;
        }

        if (this._buffer.length >= this.basePeriod) {
            const recentBase = this._buffer.slice(-this.basePeriod);
            let maxHigh = -Infinity;
            let minLow = Infinity;
            for (const c of recentBase) {
                if (c.high > maxHigh) maxHigh = c.high;
                if (c.low < minLow) minLow = c.low;
            }
            this.kijun = (maxHigh + minLow) / 2;
        }

        if (this._buffer.length >= this.laggingPeriod) {
            const recentLag = this._buffer.slice(-this.laggingPeriod);
            let maxHigh = -Infinity;
            let minLow = Infinity;
            for (const c of recentLag) {
                if (c.high > maxHigh) maxHigh = c.high;
                if (c.low < minLow) minLow = c.low;
            }
            this.senkouB = (maxHigh + minLow) / 2;
        }

        this.senkouA = (this.tenkan + this.kijun) / 2;

        if (this._buffer.length >= this.conversionPeriod + this.basePeriod) {
            this.cloudUpper = this.senkouA > this.senkouB ? this.senkouA : this.senkouB;
            this.cloudLower = this.senkouA < this.senkouB ? this.senkouA : this.senkouB;
        }

        if (this._chikouBuffer.length > this.cloudDisplacement) {
            this.chikou = this._chikouBuffer[0];
        }

        this.ready = this._buffer.length >= this.laggingPeriod;
        return this.tenkan;
    }

    reseed(candles) {
        this.tenkan = 0;
        this.kijun = 0;
        this.senkouA = 0;
        this.senkouB = 0;
        this.chikou = 0;
        this.cloudUpper = 0;
        this.cloudLower = 0;
        this.ready = false;
        this._buffer = [];
        this._chikouBuffer = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            this.update(c.high, c.low, c.close);
        }
        return this.tenkan;
    }
}

module.exports = IchimokuCloud;