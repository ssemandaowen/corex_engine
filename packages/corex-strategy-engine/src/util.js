"use strict";

const util = {
    round(val, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.round(val * factor) / factor;
    },

    positionSize(capital, riskPct, stopLossPips) {
        if (!stopLossPips || stopLossPips <= 0) return 1;
        const riskAmount = capital * (riskPct / 100);
        return riskAmount / stopLossPips;
    }
};

module.exports = util;
