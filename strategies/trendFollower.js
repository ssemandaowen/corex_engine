const BaseStrategy = require("../utils/BaseStrategy");

class TrendFollower extends BaseStrategy {
    constructor(config) {
        super(config);
        this.name = "Trend Follower Pro";
        this.symbols = ["BTC/USD"];
        
        // --- TradingView-style UI Inputs ---
        this.schema = {
            fast_ema: { type: 'number', default: 20, min: 5, max: 50, label: 'Fast EMA (Signal)' },
            slow_ema: { type: 'number', default: 50, min: 20, max: 200, label: 'Slow EMA (Trend)' },
            risk_per_trade: { type: 'float', default: 1.0, min: 0.1, max: 5.0, label: 'Risk % per Trade' }
        };

        this._applyDefaults();
    }

    onPrice(tick, isWarmup) {
        const store = this.data.get(tick.symbol);
        const candles = store.candleHistory;

        // Ensure we have enough data for the Slow EMA
        if (candles.length < this.params.slow_ema) return;

        // Extract closing prices for math calculation
        const closes = candles.map(c => c.close);

        // Calculate Indicators using data-forge-indicators (injected via BaseStrategy)
        const fastEMA = this.indicators.ema(closes, this.params.fast_ema);
        const slowEMA = this.indicators.ema(closes, this.params.slow_ema);

        const currentFast = fastEMA[fastEMA.length - 1];
        const currentSlow = slowEMA[slowEMA.length - 1];
        const prevFast = fastEMA[fastEMA.length - 2];
        const prevSlow = slowEMA[slowEMA.length - 2];

        // --- EXECUTION LOGIC ---
        
        // Bullish Cross: Fast crosses ABOVE Slow
        const bullishCross = prevFast <= prevSlow && currentFast > currentSlow;
        
        // Bearish Cross: Fast crosses BELOW Slow
        const bearishCross = prevFast >= prevSlow && currentFast < currentSlow;

        if (bullishCross && !this.position) {
            this.log.info(`📈 Trend Follower: Bullish Cross on ${tick.symbol}`);
            this.buy();
        } 
        else if (bearishCross && this.position) {
            this.log.info(`📉 Trend Follower: Trend Weakening, Closing Position`);
            this.sell();
        }
    }
}

module.exports = TrendFollower;