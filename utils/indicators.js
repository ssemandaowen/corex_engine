/**
 * CoreX Professional Technical Indicators Library
 * Production-grade implementations with MT5 logic.
 */
class Indicators {
  // --- 1. TREND ---

  static SMA(period) {
    const buffer = new Float64Array(period); // High-performance typed array
    let pos = 0;
    let size = 0;
    let sum = 0;

    return {
      update: (price) => {
        sum -= buffer[pos];
        buffer[pos] = price;
        sum += price;
        pos = (pos + 1) % period;
        if (size < period) size++;
        return size === period ? sum / period : null;
      }
    };
  }

  static EMA(period) {
    let ema = null;
    const k = 2 / (period + 1);
    return {
      update: (price) => {
        if (ema === null) {
          ema = price;
        } else {
          ema = (price - ema) * k + ema;
        }
        return ema;
      }
    };
  }

  // --- 2. OSCILLATORS ---

  static RSI(period = 14) {
    let lastPrice = null;
    let avgGain = 0;
    let avgLoss = 0;
    let count = 0;

    return {
      update: (price) => {
        if (lastPrice === null) {
          lastPrice = price;
          return null;
        }

        const diff = price - lastPrice;
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        lastPrice = price;

        if (count < period) {
          avgGain += gain;
          avgLoss += loss;
          count++;
          if (count === period) {
            avgGain /= period;
            avgLoss /= period;
          }
          return null;
        }

        // Wilder's Smoothing Method (MT5 Standard)
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
      }
    };
  }

  static MACD(fast = 12, slow = 26, signal = 9) {
    const emaFast = Indicators.EMA(fast);
    const emaSlow = Indicators.EMA(slow);
    const emaSignal = Indicators.EMA(signal);

    return {
      update: (price) => {
        const f = emaFast.update(price);
        const s = emaSlow.update(price);
        if (f === null || s === null) return null;

        const macd = f - s;
        const sig = emaSignal.update(macd);
        
        return {
          macd: macd,
          signal: sig,
          histogram: sig !== null ? macd - sig : null
        };
      }
    };
  }

  // --- 3. VOLATILITY ---

  static ATR(period = 14) {
    let lastClose = null;
    let sumTr = 0;
    let count = 0;
    let atr = null;

    return {
      update: (candle) => {
        if (lastClose === null) {
          lastClose = candle.close;
          return null;
        }
        const tr = Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - lastClose),
          Math.abs(candle.low - lastClose)
        );
        lastClose = candle.close;

        if (atr === null) {
          sumTr += tr;
          count++;
          if (count === period) atr = sumTr / period;
          return null;
        }

        atr = (atr * (period - 1) + tr) / period;
        return atr;
      }
    };
  }

  static BollingerBands(period = 20, stdDev = 2) {
    const buffer = new Float64Array(period);
    let pos = 0;
    let size = 0;

    return {
      update: (price) => {
        buffer[pos] = price;
        pos = (pos + 1) % period;
        if (size < period) size++;
        if (size < period) return null;

        const mid = buffer.reduce((a, b) => a + b, 0) / period;
        const variance = buffer.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
        const dev = Math.sqrt(variance) * stdDev;

        return { middle: mid, upper: mid + dev, lower: mid - dev };
      }
    };
  }
}

module.exports = Indicators;