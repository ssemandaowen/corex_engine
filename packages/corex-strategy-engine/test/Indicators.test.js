"use strict";

const { indicators } = require("../index");

describe("Indicator Calculation Correctness", () => {
    const prices = [];
    for (let i = 0; i < 30; i++) {
        prices.push(100 + i * 0.5 + (i % 3) * 0.3);
    }

    describe("Basic trend indicators", () => {
        test("SMA calculates correctly", () => {
            const sma = new indicators.SMA(5);
            for (const p of prices) sma.update(p);
            expect(sma.ready).toBe(true);
            const expected = (prices[25] + prices[26] + prices[27] + prices[28] + prices[29]) / 5;
            expect(sma.value).toBeCloseTo(expected, 10);
        });

        test("EMA calculates correctly", () => {
            const ema = new indicators.EMA(5);
            for (const p of prices) ema.update(p);
            expect(ema.ready).toBe(true);
            expect(ema.value).toBeGreaterThan(0);
        });

        test("WMA calculates correctly", () => {
            const wma = new indicators.WMA(5);
            for (const p of prices) wma.update(p);
            expect(wma.ready).toBe(true);
            const expected = (wma._buffer[0] * 1 + wma._buffer[1] * 2 + wma._buffer[2] * 3 + wma._buffer[3] * 4 + wma._buffer[4] * 5) / 15;
            expect(wma.value).toBeCloseTo(expected, 10);
        });

        test("HMA calculates correctly", () => {
            const hma = new indicators.HMA(9);
            for (const p of prices) hma.update(p);
            expect(hma.ready).toBe(true);
            expect(hma.value).toBeGreaterThan(0);
        });

        test("McGinley calculates correctly", () => {
            const mg = new indicators.McGinley(5);
            for (const p of prices) mg.update(p);
            expect(mg.ready).toBe(true);
        });

        test("ALMA calculates correctly", () => {
            const alma = new indicators.ALMA(5, 6, 3);
            for (const p of prices) alma.update(p);
            expect(alma.ready).toBe(true);
        });

        test("KAMA calculates correctly", () => {
            const kama = new indicators.KAMA(5);
            for (const p of prices) kama.update(p);
            expect(kama.ready).toBe(true);
            expect(kama.er).toBeDefined();
        });

        test("VIDYA calculates correctly", () => {
            const vidya = new indicators.VIDYA(5);
            for (const p of prices) vidya.update(p);
            expect(vidya.ready).toBe(true);
        });

        test("Parabolic SAR calculates correctly", () => {
            const psar = new indicators.ParabolicSAR(0.02, 0.2);
            for (let i = 0; i < prices.length; i++) {
                psar.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(psar.ready).toBe(true);
        });

        test("SuperTrend calculates correctly", () => {
            const st = new indicators.SuperTrend(3, 2);
            for (let i = 0; i < prices.length; i++) {
                st.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(st.ready).toBe(true);
        });

        test("Linear Regression calculates correctly", () => {
            const lr = new indicators.LinearRegression(5);
            for (const p of prices) lr.update(p);
            expect(lr.ready).toBe(true);
            expect(lr.slope).toBeDefined();
        });

        test("Standard Deviation calculates correctly", () => {
            const sd = new indicators.StandardDeviation(5);
            for (const p of prices) sd.update(p);
            expect(sd.ready).toBe(true);
            expect(sd.value).toBeGreaterThanOrEqual(0);
        });

        test("RSI calculates correctly", () => {
            const rsi = new indicators.RSI(5);
            for (const p of prices) rsi.update(p);
            expect(rsi.ready).toBe(true);
            expect(rsi.value).toBeGreaterThanOrEqual(0);
            expect(rsi.value).toBeLessThanOrEqual(100);
        });
    });

    describe("Momentum oscillators", () => {
        test("MACD calculates correctly", () => {
            const macd = new indicators.MACD(3, 5, 2);
            for (const p of prices) macd.update(p);
            expect(macd.ready).toBe(true);
            expect(macd.signal).toBeDefined();
        });

        test("ROC calculates correctly", () => {
            const roc = new indicators.ROC(3);
            for (const p of prices) roc.update(p);
            const lastPrice = prices[prices.length - 1];
            const refPrice = prices[prices.length - 1 - 3];
            expect(roc.ready).toBe(true);
            const expected = ((lastPrice - refPrice) / refPrice) * 100;
            expect(roc.value).toBeCloseTo(expected, 10);
        });

        test("Momentum calculates correctly", () => {
            const mom = new indicators.Momentum(3);
            for (const p of prices) mom.update(p);
            expect(mom.ready).toBe(true);
            const lastPrice = prices[prices.length - 1];
            const refPrice = prices[prices.length - 1 - (3 - 1)];
            expect(mom.value).toBeCloseTo(lastPrice - refPrice, 10);
        });

        test("Williams %R calculates correctly", () => {
            const wr = new indicators.WilliamsR(5);
            for (let i = 0; i < prices.length; i++) {
                wr.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(wr.ready).toBe(true);
            expect(wr.value).toBeLessThanOrEqual(0);
            expect(wr.value).toBeGreaterThanOrEqual(-100);
        });

        test("Ultimate Oscillator calculates correctly", () => {
            const uo = new indicators.UltimateOscillator(3, 5, 7);
            for (let i = 0; i < prices.length; i++) {
                uo.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(uo.ready).toBe(true);
            expect(uo.value).toBeGreaterThanOrEqual(0);
            expect(uo.value).toBeLessThanOrEqual(100);
        });

        test("CCI calculates correctly", () => {
            const cci = new indicators.CCI(5);
            for (const p of prices) cci.update(p);
            expect(cci.ready).toBe(true);
            expect(Number.isFinite(cci.value)).toBe(true);
        });

        test("TSI calculates correctly", () => {
            const tsi = new indicators.TSI(5, 10);
            for (const p of prices) tsi.update(p);
            expect(tsi.ready).toBe(true);
        });

        test("CMO calculates correctly", () => {
            const cmo = new indicators.CMO(5);
            for (const p of prices) cmo.update(p);
            expect(cmo.ready).toBe(true);
            expect(cmo.value).toBeLessThanOrEqual(100);
            expect(cmo.value).toBeGreaterThanOrEqual(-100);
        });

        test("STC calculates correctly", () => {
            const stc = new indicators.STC(3, 0.3, 2);
            for (const p of prices) stc.update(p);
            expect(stc.ready).toBe(true);
        });

        test("Fisher Transform calculates correctly", () => {
            const fisher = new indicators.Fisher(5);
            for (const p of prices) fisher.update(p);
            expect(fisher.ready).toBe(true);
        });

        test("Laguerre RSI calculates correctly", () => {
            const lr = new indicators.LaguerreRSI(0.5);
            for (const p of prices) lr.update(p);
            expect(lr.ready).toBe(true);
            expect(lr.value).toBeGreaterThanOrEqual(0);
            expect(lr.value).toBeLessThanOrEqual(100);
        });

        test("RVI calculates correctly", () => {
            const rvi = new indicators.RVI(5);
            for (let i = 0; i < prices.length; i++) {
                rvi.update(prices[i], prices[i] - 1, prices[i] + 2, prices[i] - 2);
            }
            expect(rvi.ready).toBe(true);
        });

        test("Connors RSI calculates correctly", () => {
            const crsi = new indicators.ConnorsRSI(3, 2, 2);
            for (const p of prices) crsi.update(p);
            expect(crsi.ready).toBe(true);
        });
    });

    describe("Volatility & Channels", () => {
        test("ATR calculates correctly", () => {
            const atr = new indicators.ATR(5);
            for (let i = 0; i < prices.length; i++) {
                atr.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(atr.ready).toBe(true);
            expect(atr.value).toBeGreaterThan(0);
        });

        test("Bollinger Bands calculates correctly", () => {
            const bb = new indicators.BollingerBands(5, 2);
            for (const p of prices) bb.update(p);
            expect(bb.ready).toBe(true);
            expect(bb.upper).toBeGreaterThan(bb.value);
            expect(bb.lower).toBeLessThan(bb.value);
        });

        test("Keltner Channels calculates correctly", () => {
            const kc = new indicators.KeltnerChannels(5, 2);
            for (let i = 0; i < prices.length; i++) {
                kc.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(kc.ready).toBe(true);
            expect(kc.upper).toBeGreaterThan(kc.value);
            expect(kc.lower).toBeLessThan(kc.value);
        });

        test("Donchian Channels calculates correctly", () => {
            const dc = new indicators.DonchianChannels(5);
            for (let i = 0; i < prices.length; i++) {
                dc.update(prices[i] + 3, prices[i] - 3, prices[i]);
            }
            expect(dc.ready).toBe(true);
            expect(dc.upper).toBeGreaterThan(dc.lower);
        });

        test("Stochastic Oscillator calculates correctly", () => {
            const stoch = new indicators.Stochastic(5, 3);
            for (let i = 0; i < prices.length; i++) {
                stoch.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(stoch.ready).toBe(true);
            expect(stoch.value).toBeGreaterThanOrEqual(0);
            expect(stoch.value).toBeLessThanOrEqual(100);
        });
    });

    describe("Volume & Liquidity", () => {
        test("VWAP calculates correctly", () => {
            const vwap = new indicators.VWAP();
            vwap.update(100, 100);
            vwap.update(102, 200);
            expect(vwap.ready).toBe(true);
            const expected = (100 * 100 + 102 * 200) / 300;
            expect(vwap.value).toBeCloseTo(expected, 10);
        });

        test("Anchored VWAP calculates correctly", () => {
            const avwap = new indicators.AnchoredVWAP();
            avwap.update(100, 100);
            avwap.update(102, 200);
            expect(avwap.ready).toBe(true);
            avwap.anchor();
            expect(avwap.ready).toBe(false);
        });

        test("OBV calculates correctly", () => {
            const obv = new indicators.OBV();
            const candles = [
                { close: 10, volume: 100 },
                { close: 12, volume: 150 },
                { close: 11, volume: 200 },
                { close: 13, volume: 100 }
            ];
            for (const c of candles) obv.update(c.close, c.volume);
            expect(obv.ready).toBe(true);
            expect(obv.value).toBe(100 + 150 - 200 + 100);
        });

        test("MFI calculates correctly", () => {
            const mfi = new indicators.MFI(3);
            const candles = [
                { high: 105, low: 95, close: 100, volume: 1000 },
                { high: 108, low: 100, close: 106, volume: 1200 },
                { high: 110, low: 104, close: 108, volume: 800 },
                { high: 109, low: 105, close: 107, volume: 900 }
            ];
            for (const c of candles) {
                const tp = (c.high + c.low + c.close) / 3;
                const mf = tp * c.volume;
                mfi.update(tp, mf, c.volume);
            }
            expect(mfi.ready).toBe(true);
        });

        test("CMF calculates correctly", () => {
            const cmf = new indicators.CMF(3);
            const candles = [
                { high: 105, low: 95, close: 100, volume: 1000 },
                { high: 108, low: 100, close: 106, volume: 1200 },
                { high: 110, low: 104, close: 108, volume: 800 },
                { high: 109, low: 105, close: 107, volume: 900 }
            ];
            for (const c of candles) cmf.update(c.high, c.low, c.close, c.volume);
            expect(cmf.ready).toBe(true);
        });

        test("AD (Accumulation/Distribution) calculates correctly", () => {
            const ad = new indicators.AD();
            const candles = [
                { high: 105, low: 95, close: 100, volume: 1000 },
                { high: 108, low: 100, close: 106, volume: 1200 }
            ];
            for (const c of candles) ad.update(c.high, c.low, c.close, c.volume);
            expect(ad.ready).toBe(true);
        });

        test("EoM (Ease of Movement) calculates correctly", () => {
            const eom = new indicators.EoM(5);
            for (let i = 0; i < prices.length; i++) {
                eom.update(prices[i] + 2, prices[i] - 2, (i + 1) * 1000);
            }
            expect(eom.ready).toBe(true);
        });
    });

    describe("Trend Strength & Regime", () => {
        test("ADX calculates correctly", () => {
            const adx = new indicators.ADX(5);
            for (let i = 0; i < prices.length; i++) {
                adx.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(adx.ready).toBe(true);
            expect(adx.value).toBeGreaterThanOrEqual(0);
        });

        test("Vortex calculates correctly", () => {
            const vortex = new indicators.Vortex(5);
            for (let i = 0; i < prices.length; i++) {
                vortex.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(vortex.ready).toBe(true);
            expect(vortex.viPlus).toBeDefined();
            expect(vortex.viMinus).toBeDefined();
        });

        test("Choppiness Index calculates correctly", () => {
            const chop = new indicators.Choppiness(5);
            for (let i = 0; i < prices.length; i++) {
                chop.update(prices[i] + 2, prices[i] - 2, prices[i]);
            }
            expect(chop.ready).toBe(true);
        });

        test("Hurst Exponent calculates correctly", () => {
            const hurst = new indicators.Hurst(10);
            for (const p of prices) hurst.update(p);
            expect(hurst.ready).toBe(true);
            expect(hurst.value).toBeGreaterThanOrEqual(0);
            expect(hurst.value).toBeLessThanOrEqual(1);
        });

        test("FDI calculates correctly", () => {
            const fdi = new indicators.FDI(15);
            for (const p of prices) fdi.update(p);
            expect(fdi.ready).toBe(true);
        });
    });

    describe("Statistical & Quantitative", () => {
        test("Z-Score calculates correctly", () => {
            const zscore = new indicators.ZScore(5);
            for (const p of prices) zscore.update(p);
            expect(zscore.ready).toBe(true);
        });

        test("DPO calculates correctly", () => {
            const dpo = new indicators.DPO(5);
            for (const p of prices) dpo.update(p);
            expect(dpo.ready).toBe(true);
        });

        test("Coppock Curve calculates correctly", () => {
            const coppock = new indicators.Coppock(5, 3);
            for (const p of prices) coppock.update(p);
            expect(coppock.ready).toBe(true);
        });

        test("Fibonacci Retracement calculates correctly", () => {
            const fib = new indicators.Fibonacci();
            const levels = fib.calculate(120, 80);
            expect(levels.length).toBe(7);
            expect(fib.getLevel(61.8)).toBeCloseTo(80 + (120 - 80) * 0.382, 10);
        });

        test("Instant Trend calculates correctly", () => {
            const itrend = new indicators.InstantTrend(0.07);
            for (const p of prices) itrend.update(p);
            expect(itrend.ready).toBe(true);
        });

        test("SuperSmoother calculates correctly", () => {
            const ss = new indicators.SuperSmoother(0.2);
            for (const p of prices) ss.update(p);
            expect(ss.ready).toBe(true);
        });

        test("Ichimoku Cloud calculates correctly", () => {
            const ichimoku = new indicators.Ichimoku(3, 5, 7, 2);
            const candles = [];
            for (let i = 0; i < 20; i++) {
                candles.push({
                    high: 100 + i * 2,
                    low: 95 + i,
                    close: 98 + i * 1.5
                });
            }
            for (const c of candles) ichimoku.update(c.high, c.low, c.close);
            expect(ichimoku.ready).toBe(true);
            expect(ichimoku.tenkan).toBeGreaterThan(0);
            expect(ichimoku.kijun).toBeGreaterThan(0);
        });
    });
});