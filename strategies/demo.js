"use strict";
const Strategy = require("@utils/BaseStrategy");

class DemoStrategy extends Strategy {
    constructor() {
        super({
            name: "Full Demo Strategy",
            symbols: ["BTC/USD", "ETH/USD"],
            timeframe: "1m",
            lookback: 20
        });
        this.enabled = true;
    }

    next(bar, isWarmup) {
        if (isWarmup) return null;

        const pips = 0.0001;

        // 1. EXIT LOGIC (If we have a position, check if we should close it)
        if (this.position) {
            const entryPrice = this.position.entry;
            const currentPrice = bar.close;
            const diff = currentPrice - entryPrice;

            if (this.position.type === 'LONG') {
                if (diff >= 10 * pips || diff <= -5 * pips) return this.exit();
            } else if (this.position.type === 'SHORT') {
                if (diff <= -10 * pips || diff >= 5 * pips) return this.exit();
            }
            return null; // Hold position if no exit hit
        }

        // 2. ENTRY LOGIC (If no position, check for new signals)
        if (bar.close > bar.open) {
            return this.buy(); // Go Long
        } else if (bar.close < bar.open) {
            return this.sell(); // Go Short
        }

        return null;
    }
}

module.exports = DemoStrategy;