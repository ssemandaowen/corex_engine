"use strict";

const LEGACY_PIP_SCALE = {
    "JPY": 2,
    "EURJPY": 2,
    "USDJPY": 2,
    "GBPJPY": 2,
    "AUDJPY": 2,
    "CADJPY": 2,
    "NZDJPY": 2,
    "CHFJPY": 2,
    "EURUSD": 4,
    "GBPUSD": 4,
    "AUDUSD": 4,
    "NZDUSD": 4,
    "USDCAD": 4,
    "USDCHF": 4,
    "EURGBP": 4,
    "EURNZD": 4,
    "GBPJPY": 2,
    "EURAUD": 4,
    "GBPAUD": 4,
    "AUDNZD": 4,
    "BTCUSD": 2,
    "ETHUSD": 2,
    "XRPUSD": 6,
    "LTCUSD": 2,
    "SPX500": 2,
    "NAS100": 2,
    "XAUUSD": 4,
    "XAGUSD": 4,
    "BTCUSDT": 2,
    "ETHUSDT": 2
};
const PIPCOST_PRECISION = 100000;

function _lookupRaw(symbol) {
    const upper = symbol.toUpperCase();
    if (LEGACY_PIP_SCALE[upper]) return LEGACY_PIP_SCALE[upper];
    if (upper.endsWith("JPY")) return 2;
    if (upper.endsWith("USD")) return 4;
    if (upper.length <= 3) return 4;
    return 4;
}

module.exports = {
    normalize: function(symbol) {
        if (!symbol) return { symbol: "", pipScale: 0, digits: 0 };
        const canonical = String(symbol).toUpperCase().replace(/[\/_\-\.]/g, "");
        const pipScale = _lookupRaw(canonical);
        const digits = pipScale;
        return { symbol: canonical, pipScale, digits };
    },
    fromProvider: function(providerSymbol) {
        const { symbol, pipScale, digits } = this.normalize(providerSymbol);
        const oandaSymbol = symbol.slice(0, 3) + "/" + symbol.slice(3);
        return { symbol, pipScale, digits, oanda: oandaSymbol, twelvedata: symbol, yahoo: symbol };
    },
    pipScale: function(symbol) {
        return this.normalize(symbol).pipScale;
    },
    toPips: function(priceDiff, symbol) {
        const { pipScale } = this.normalize(symbol);
        return priceDiff * Math.pow(10, pipScale);
    },
    fromPips: function(pips, symbol) {
        const { pipScale } = this.normalize(symbol);
        return pips / Math.pow(10, pipScale);
    },
    LEGACY_PIP_SCALE
};
