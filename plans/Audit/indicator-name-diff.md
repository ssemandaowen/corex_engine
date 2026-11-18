# Indicator Name Differences: IndicatorRegistry vs technicalindicators

Generated: $(date)

## Summary
- `IndicatorRegistry` contains custom strategy-engine indicators (50 registered).
- `technicalindicators` package contains standard technical analysis indicators and functions (120 exported keys).

## Indicators in `IndicatorRegistry` NOT in `technicalindicators` (34 total):
- HMA
- McGinley
- ALMA
- KAMA
- VIDYA
- ParabolicSAR
- SuperTrend
- LinearRegression
- StandardDeviation
- Momentum
- UltimateOscillator
- TSI
- CMO
- STC
- Fisher
- LaguerreRSI
- RVI
- ConnorsRSI
- DonchianChannels
- AnchoredVWAP
- CMF
- AD
- EoM
- Vortex
- Choppiness
- Hurst
- FDI
- ZScore
- DPO
- Coppock
- Fibonacci
- InstantTrend
- SuperSmoother
- Ichimoku

## Indicators/Utilities in `technicalindicators` NOT in `IndicatorRegistry` (104 total):
- FixedSizeLinkedList, CandleData, CandleList, sma, ema, wma, wema, WEMA, macd, rsi, bollingerbands, adx, atr, truerange, TrueRange, roc, kst, KST, psar, PSAR, stochastic, williamsr, adl, ADL, obv, trix, TRIX, forceindex, ForceIndex, cci, awesomeoscillator, AwesomeOscillator, vwap, volumeprofile, VolumeProfile, mfi, stochasticrsi, StochasticRSI, averagegain, AverageGain, averageloss, AverageLoss, sd, SD, highest, Highest, lowest, Lowest, sum, Sum, renko, HeikinAshi, heikinashi, bullish, bearish, abandonedbaby, doji, bearishengulfingpattern, bullishengulfingpattern, darkcloudcover, downsidetasukigap, dragonflydoji, gravestonedoji, bullishharami, bearishharami, bullishharamicross, bearishharamicross, eveningdojistar, eveningstar, morningdojistar, morningstar, bullishmarubozu, bearishmarubozu, piercingline, bullishspinningtop, bearishspinningtop, threeblackcrows, threewhitesoldiers, bullishhammerstick, bearishhammerstick, bullishinvertedhammerstick, bearishinvertedhammerstick, hammerpattern, hammerpatternunconfirmed, hangingman, hangingmanunconfirmed, shootingstar, shootingstarunconfirmed, tweezertop, tweezerbottom, fibonacciretracement, ichimokucloud, IchimokuCloud, keltnerchannels, KeltnerChannelsInput, KeltnerChannelsOutput, chandelierexit, ChandelierExit, ChandelierExitInput, ChandelierExitOutput, stochasticrsi, StochasticRSIInput, StochasticRSIOutput
