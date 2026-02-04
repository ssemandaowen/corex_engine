"use strict";
const BaseStrategy = require('@utils/BaseStrategy');

class boom extends BaseStrategy {
    constructor() {
        super({
            symbols: ["BTC/USD"],
            lookback: 20
        });

        this.params = {
            emaPeriod: 10
        };
    }

    next(data, isWarmedUp) {
        if (!isWarmedUp) return null;
        // Your logic here
        return null;
    }
}

module.exports = boom;
