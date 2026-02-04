"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

class Crossover extends BaseStrategy {
    constructor() {
        super({
            symbols: ["BTC/USD"],
            lookback: 60,
            timeframe: "1m"
        });

        this.schema = {
            fastPeriod: 10,
            slowPeriod: 30
        };

        this._isLong = false;
    }

    next(data, isWarmedUp) {
        const symbol = data.symbol || this.symbols[0];
        if (!isWarmedUp) return null;

        const history = this.getLookbackWindow(symbol);
        const closes = history.map(c => c.close);

        const fast = this.indicators.EMA.calculate({
            period: this.params.fastPeriod,
            values: closes
        });

        const slow = this.indicators.EMA.calculate({
            period: this.params.slowPeriod,
            values: closes
        });

        if (fast.length < 2 || slow.length < 2) return null;

        const fastPrev = fast[fast.length - 2];
        const fastNow = fast[fast.length - 1];
        const slowPrev = slow[slow.length - 2];
        const slowNow = slow[slow.length - 1];

        const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
        const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;

        if (crossedUp && !this._isLong) {
            this._isLong = true;
            return this.buy({ symbol });
        }

        if (crossedDown && this._isLong) {
            this._isLong = false;
            return this.exit({ symbol });
        }

        return null;
    }
}

module.exports = Crossover;
