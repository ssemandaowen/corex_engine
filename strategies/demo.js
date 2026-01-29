"use strict";
const BaseStrategy = require('@utils/BaseStrategy');

class ValidationStrategy extends BaseStrategy {
    constructor() {
        super({
            name: "CoreX_Validation_v1",
            symbols: ["BTC/USD"],
            lookback: 20
        });
        
        this.params = { emaPeriod: 10 };
        // Internal state tracker for debugging purposes
        this._isLong = false; 
    }

   next(data) {
    const symbol = data.symbol || this.symbols[0];
    const history = this.getLookbackWindow(symbol);
    
    if (!this.isWarmedUp(symbol)) return null;

    const prices = history.map(c => c.close);
    const ema = this.indicators.EMA.calculate({ 
        period: this.params.emaPeriod, 
        values: prices 
    });
    
    const lastEma = ema[ema.length - 1];
    const currentPrice = data.close;

    // ADDED: 0.01% Buffer to prevent flickering
    const longThreshold = lastEma * 1.0001; 
    const exitThreshold = lastEma * 0.9999;

    if (currentPrice > longThreshold && !this._isLong) {
        this._isLong = true;
        return this.buy({ symbol });
    } 
    
    else if (currentPrice < exitThreshold && this._isLong) {
        this._isLong = false;
        return this.exit({ symbol });
    }

    return null;
}
}

module.exports = ValidationStrategy;