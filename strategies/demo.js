"use strict";

const Strategy = require("./baseStrategy");

/**
 * @class FinalCheck
 * @description CoreX-compliant flip-flop strategy for engine validation.
 */
class FinalCheck extends Strategy {
    constructor() {
        super({
            name: "Final Trend Check",
            symbols: ["BTC/USD"],
            timeframe: "1m",
            lookback: 20 
        });

        // 1. Parameter Schema (Decided by Server/Strategy)
        this.schema = {
            stopLoss: { default: 2.0, type: 'number' },
            riskReward: { default: 1.5, type: 'number' }
        };

        // 2. Lifecycle: Initialize from Schema
        this.initParams();

        // 3. Persistent Logic State
        this.readyToBuy = true; 
    }

    /**
     * @override
     * Core logic loop. Execution is anchored to candle start times.
     */
    next(tick, isWarmup) {
        if (isWarmup) return;

        if (this.readyToBuy) {
            if (this.buy()) {
                this.readyToBuy = false;
            }
        } else {
            if (this.exit()) {
                this.readyToBuy = true;
            }
        }
    }
}

module.exports = FinalCheck;