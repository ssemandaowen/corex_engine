"use strict";
const BaseStrategy = require("@utils/BaseStrategy");

class EmaCrossover extends BaseStrategy {
    constructor() {
        super({
            name: "ema_crossover",
            symbols: ["BTC/USD"],
            lookback: 200,
            timeframe: "15m"
        });

        this.schema = {
            fastPeriod: { type: "integer", min: 2, max: 200, default: 12 },
            slowPeriod: { type: "integer", min: 5, max: 400, default: 26 }
        };
        this._applyDefaults();
    }

    next(data) {
        const symbol = data.symbol || this.symbols[0];

        // 1. Warm-up Guard
        if (!this.isWarmedUp(symbol)) return null;

        // 2. Data Preparation
        const closes = this.series(symbol, "close");
        const fastEMA = this.indicators.EMA.calculate({
            period: this.params.fastPeriod,
            values: closes
        });
        const slowEMA = this.indicators.EMA.calculate({
            period: this.params.slowPeriod,
            values: closes
        });

        if (fastEMA.length < 2 || slowEMA.length < 2) return null;

        // 3. Signal Detection
        // Note: StrategySignalUtils now handles the "Once per state per bar" logic
        const isCrossUp = this.crossover(fastEMA, slowEMA, data);
        const isCrossDown = this.crossunder(fastEMA, slowEMA, data);

        const chain = this.rule(data);

        // 4. Execution Logic
        if (isCrossUp) {
            // If Short -> Flip to Long; If Flat -> Enter Long
            if (this.pos("short", symbol)) return chain.flipToLong({ symbol }).value();
            if (this.pos("flat", symbol)) return chain.enterLong({ symbol }).value();
        }

        if (isCrossDown) {
            // If Long -> Flip to Short; If Flat -> Enter Short
            if (this.pos("long", symbol)) return chain.flipToShort({ symbol }).value();
            if (this.pos("flat", symbol)) return chain.enterShort({ symbol }).value();
        }

        return null;
    }
}

module.exports = EmaCrossover;