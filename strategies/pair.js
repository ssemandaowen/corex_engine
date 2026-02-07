const strategy = require('@utils/BaseStrategy');

class PairTrading extends strategy {
    constructor() {
        super({ 
            name: "pair_trading",
            symbols: ["BTC/USD", "ETH/USD"],
            lookback: 200,
            timeframe: "15m"
        });
    }

    next(data) {
        const [symA, symB] = this.symbols;
        const closesA = this.series(symA, "close");
        const closesB = this.series(symB, "close");

        if (closesA.length < 2 || closesB.length < 2) return null;

        // Simple Mean Reversion Logic
        const ratio = closesA[closesA.length - 1] / closesB[closesB.length - 1];
        const meanRatio = this.indicators.SMA.calculate({ period: 50, values: ratio });
        const stdRatio = this.indicators.STDDEV.calculate({ period: 50, values: ratio });

        if (ratio > meanRatio + stdRatio) {
            // A is expensive relative to B -> Short A, Long B
            if (this.pos("flat", symA) && this.pos("flat", symB)) {
                return this.rule(data)
                    .whenPos("flat", symA).flipToShort({ symbol: symA })
                    .whenPos("flat", symB).flipToLong({ symbol: symB })
                    .value();
            }
        } else if (ratio < meanRatio - stdRatio) {
            // B is expensive relative to A -> Short B, Long A
            if (this.pos("flat", symA) && this.pos("flat", symB)) {
                return this.rule(data)
                    .whenPos("flat", symA).flipToLong({ symbol: symA })
                    .whenPos("flat", symB).flipToShort({ symbol: symB })
                    .value();
            }
        }

        return null;
    }
}

module.exports = PairTrading;       