"use strict";
const BaseStrategy = require('@utils/BaseStrategy');

class ValidationStrategy extends BaseStrategy {
    constructor() {
        super({
            symbols: ["BTC/USD"],
            lookback: 20,
        });
        
        this.params = { emaPeriod: 10 };
        // Internal state tracker for debugging purposes
        this._isLong = false; 
    }

   next(data, isWarmedUp) {
   let isUp = data.close > data.open;
   let isDown = data.close < data.open;

    if (isUp) {
        this._isLong = true;
        return this.buy();
    } 
    
    if (isDown) {
        this._isLong = false;
        return this.exit();
    }

    return null;
}
}

module.exports = ValidationStrategy;