"use strict";

/**
 * @utils/analytics.js
 *
 * Global analytics utility for CoreX.
 * Pure functions only — no I/O, no state, no side effects.
 * Every export is deterministic: same input → same output.
 *
 * Namespaces:
 *   trades   — scalar performance metrics from a trade list
 *   series   — time-series curves (equity, drawdown, returns)
 *   risk     — VaR, CVaR, Kelly, volatility, position sizing
 *   rolling  — sliding-window statistics (Sharpe, vol, mean, beta)
 *   bar      — OHLCV bar math (ATR, VWAP, gaps, range)
 *   format   — display formatting (strings, report assembly)
 *
 * Usage:
 *   const { trades, series, risk, rolling, bar, format } = require("@utils/analytics");
 *   const stats = trades.computeStats(myTrades, 10000, gradeStats);
 *   const curve = series.equityCurve(10000, myTrades);
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _n    = (v, fallback = 0) => { const x = Number(v); return Number.isFinite(x) ? x : fallback; };
const _pct  = (v) => `${_n(v).toFixed(2)}%`;
const _fix2 = (v) => _n(v).toFixed(2);

/**
 * Compute mean and population variance of a numeric array in a single pass.
 * Returns { mean, variance, std, n }.
 */
function _moments(arr) {
    const n = arr.length;
    if (n === 0) return { mean: 0, variance: 0, std: 0, n: 0 };
    let sum = 0;
    let sumSq = 0;
    for (const v of arr) { sum += v; sumSq += v * v; }
    const mean     = sum / n;
    const variance = Math.max(0, (sumSq / n) - (mean * mean));
    return { mean, variance, std: Math.sqrt(variance), n };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — trades
// Scalar performance metrics derived from a flat trade list.
// ─────────────────────────────────────────────────────────────────────────────

const trades = {

    /**
     * Compute the full set of scalar performance metrics.
     *
     * @param {object[]} tradeList      - array of trade objects with a `.profit` field
     * @param {number}   initialCapital - starting equity (> 0)
     * @param {object}   [supplement]   - optional output from grademark analyze()
     *                                    providing maxDrawdownPct, sharpeRatio, profit
     * @returns {TradeStats}
     */
    computeStats(tradeList, initialCapital, supplement = {}) {
        const safe    = Array.isArray(tradeList) ? tradeList : [];
        const capital = _n(initialCapital, 10_000);

        const wins   = safe.filter((t) => _n(t?.profit) > 0);
        const losses = safe.filter((t) => _n(t?.profit) < 0);

        const grossProfit  = wins.reduce((s, t)   => s + _n(t.profit), 0);
        const grossLoss    = losses.reduce((s, t) => s + Math.abs(_n(t.profit)), 0);
        const winRate      = safe.length > 0 ? wins.length / safe.length : 0;
        const avgWin       = wins.length   > 0 ? grossProfit / wins.length   : 0;
        const avgLoss      = losses.length > 0 ? grossLoss   / losses.length : 0;
        const expectancy   = (winRate * avgWin) - ((1 - winRate) * avgLoss);
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

        const netProfit = _n(supplement.profit);
        const maxDD     = _n(supplement.maxDrawdownPct);
        const sharpe    = _n(supplement.sharpeRatio);

        return {
            // Formatted strings — for display
            netProfit:           _fix2(netProfit),
            roiPercent:          _fix2((netProfit / capital) * 100),
            maxDrawdownPercent:  _fix2(maxDD),
            totalTrades:         safe.length,
            winRate:             safe.length > 0 ? _fix2(winRate * 100) : "0.00",
            sharpeRatio:         sharpe ? _fix2(sharpe) : "N/A",
            profitFactor:        profitFactor != null ? _fix2(profitFactor) : "N/A",
            grossProfit:         _fix2(grossProfit),
            grossLoss:           _fix2(grossLoss),
            avgWin:              _fix2(avgWin),
            avgLoss:             _fix2(avgLoss),
            expectancy:          _fix2(expectancy),

            // Raw numbers — for charts and further computation
            raw: {
                netProfit,
                roiPercent:          (netProfit / capital) * 100,
                maxDrawdownPercent:  maxDD,
                totalTrades:         safe.length,
                winRate:             winRate * 100,
                sharpeRatio:         sharpe,
                profitFactor:        profitFactor ?? 0,
                grossProfit,
                grossLoss,
                avgWin,
                avgLoss,
                expectancy
            }
        };
    },

    /**
     * Compute the consecutive win/loss streak lengths.
     * Useful for visualising strategy consistency.
     *
     * @param {object[]} tradeList
     * @returns {{ maxWinStreak: number, maxLossStreak: number, currentStreak: number, currentStreakType: "win"|"loss"|"none" }}
     */
    streaks(tradeList) {
        const safe = Array.isArray(tradeList) ? tradeList : [];
        let maxWin = 0, maxLoss = 0, cur = 0;
        let curType = "none";

        for (const t of safe) {
            const isWin = _n(t?.profit) > 0;
            if (cur === 0) {
                cur     = 1;
                curType = isWin ? "win" : "loss";
            } else if ((isWin && curType === "win") || (!isWin && curType === "loss")) {
                cur++;
            } else {
                if (curType === "win")  maxWin  = Math.max(maxWin,  cur);
                if (curType === "loss") maxLoss = Math.max(maxLoss, cur);
                cur     = 1;
                curType = isWin ? "win" : "loss";
            }
        }
        if (curType === "win")  maxWin  = Math.max(maxWin,  cur);
        if (curType === "loss") maxLoss = Math.max(maxLoss, cur);

        return { maxWinStreak: maxWin, maxLossStreak: maxLoss, currentStreak: cur, currentStreakType: curType };
    },

    /**
     * Bucket trades by hour-of-day (0–23) to surface time-of-day performance patterns.
     *
     * @param {object[]} tradeList  - trades must have `.entryTime` (ms timestamp)
     * @returns {Array<{ hour: number, count: number, totalProfit: number, avgProfit: number }>}
     */
    byHour(tradeList) {
        const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, totalProfit: 0 }));
        for (const t of (tradeList || [])) {
            const ts = _n(t?.entryTime || t?.exitTime);
            if (!ts) continue;
            const h = new Date(ts).getUTCHours();
            buckets[h].count++;
            buckets[h].totalProfit += _n(t.profit);
        }
        return buckets.map((b) => ({
            ...b,
            avgProfit: b.count > 0 ? b.totalProfit / b.count : 0
        }));
    },

    /**
     * Compute average holding duration (ms) across all trades.
     *
     * @param {object[]} tradeList
     * @returns {{ avgMs: number, avgMinutes: number, avgHours: number }}
     */
    avgHoldTime(tradeList) {
        const safe  = (tradeList || []).filter((t) => t?.exitTime && t?.entryTime);
        if (!safe.length) return { avgMs: 0, avgMinutes: 0, avgHours: 0 };
        const totalMs = safe.reduce((s, t) => s + (_n(t.exitTime) - _n(t.entryTime)), 0);
        const avgMs   = totalMs / safe.length;
        return { avgMs, avgMinutes: avgMs / 60_000, avgHours: avgMs / 3_600_000 };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — series
// Time-series curve construction from trades or equity snapshots.
// ─────────────────────────────────────────────────────────────────────────────

const series = {

    /**
     * Build a chronological equity curve from a trade list.
     * Sorted by exit time; initial capital is the first point.
     *
     * @param {number}   initialCapital
     * @param {object[]} tradeList      - must have `.profit` and `.exitTime` or `.entryTime`
     * @param {number}   [fallbackTs]   - timestamp for the first point when no trades exist
     * @returns {Array<{ time: number, equity: number }>}
     */
    equityCurve(initialCapital, tradeList = [], fallbackTs = Date.now()) {
        const capital = _n(initialCapital);
        const sorted  = [...tradeList]
            .map((t) => ({ profit: _n(t?.profit), exitTs: _n(t?.exitTime || t?.entryTime || fallbackTs) }))
            .filter((t) => Number.isFinite(t.exitTs))
            .sort((a, b) => a.exitTs - b.exitTs);

        let equity    = capital;
        const curve   = [{ time: _n(fallbackTs), equity: capital }];
        for (const t of sorted) {
            equity += t.profit;
            curve.push({ time: t.exitTs, equity });
        }
        return curve;
    },

    /**
     * Compute drawdown percentage at every point of an equity curve.
     * 0 at new highs; negative during drawdown periods.
     *
     * @param {Array<{ time: number, equity: number }>} equityCurve
     * @returns {Array<{ time: number, drawdown: number }>}
     */
    drawdownCurve(equityCurve) {
        if (!Array.isArray(equityCurve) || equityCurve.length === 0) return [];
        let peak = equityCurve[0].equity;
        return equityCurve.map((p) => {
            if (p.equity > peak) peak = p.equity;
            const drawdown = peak > 0 ? ((p.equity / peak) - 1) * 100 : 0;
            return { time: p.time, drawdown };
        });
    },

    /**
     * Compute period-over-period percentage returns from an equity curve.
     * Points where the previous equity is 0 are skipped.
     *
     * @param {Array<{ time: number, equity: number }>} equityCurve
     * @returns {Array<{ time: number, value: number }>}
     */
    returns(equityCurve) {
        if (!Array.isArray(equityCurve) || equityCurve.length < 2) return [];
        const out = [];
        for (let i = 1; i < equityCurve.length; i++) {
            const prev = equityCurve[i - 1].equity;
            if (prev !== 0) out.push({ time: equityCurve[i].time, value: (equityCurve[i].equity / prev) - 1 });
        }
        return out;
    },

    /**
     * Compute an underwater equity curve — the absolute drawdown value (not %)
     * at each point. Useful for absolute dollar-risk charts.
     *
     * @param {Array<{ time: number, equity: number }>} equityCurve
     * @returns {Array<{ time: number, underwater: number }>}
     */
    underwaterCurve(equityCurve) {
        if (!Array.isArray(equityCurve) || equityCurve.length === 0) return [];
        let peak = equityCurve[0].equity;
        return equityCurve.map((p) => {
            if (p.equity > peak) peak = p.equity;
            return { time: p.time, underwater: p.equity - peak };
        });
    },

    /**
     * Run the full series pipeline in one call.
     * Returns equityCurve, drawdownCurve, underwaterCurve, and returns together.
     *
     * @param {number}   initialCapital
     * @param {object[]} tradeList
     * @param {number}   [fallbackTs]
     * @returns {{ equityCurve, drawdownCurve, underwaterCurve, returns }}
     */
    all(initialCapital, tradeList, fallbackTs = Date.now()) {
        const eq  = series.equityCurve(initialCapital, tradeList, fallbackTs);
        const ret = series.returns(eq);
        return {
            equityCurve:     eq,
            drawdownCurve:   series.drawdownCurve(eq),
            underwaterCurve: series.underwaterCurve(eq),
            returns:         ret
        };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — risk
// Position-level and portfolio-level risk metrics.
// ─────────────────────────────────────────────────────────────────────────────

const risk = {

    /**
     * Historical Value at Risk (VaR) at a given confidence level.
     * Sorts the return distribution and reads the tail percentile.
     *
     * @param {number[]} returnValues  - array of period returns (decimals, e.g. 0.02)
     * @param {number}   [confidence]  - confidence level, default 0.95
     * @returns {number}  VaR as a positive fraction (e.g. 0.03 = 3% loss threshold)
     */
    var(returnValues, confidence = 0.95) {
        const r = [...(returnValues || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (r.length === 0) return 0;
        const idx = Math.floor((1 - confidence) * r.length);
        return Math.abs(r[Math.max(0, idx)] || 0);
    },

    /**
     * Conditional Value at Risk (CVaR / Expected Shortfall).
     * The expected loss given that the loss exceeds VaR.
     * A more conservative and coherent risk measure than VaR alone.
     *
     * @param {number[]} returnValues
     * @param {number}   [confidence]
     * @returns {number}  CVaR as a positive fraction
     */
    cvar(returnValues, confidence = 0.95) {
        const r   = [...(returnValues || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (r.length === 0) return 0;
        const cutIdx  = Math.floor((1 - confidence) * r.length);
        const tail    = r.slice(0, Math.max(1, cutIdx));
        const avgTail = tail.reduce((s, v) => s + v, 0) / tail.length;
        return Math.abs(avgTail || 0);
    },

    /**
     * Kelly Criterion — optimal fraction of capital to risk per trade.
     * Full Kelly: f* = W - (1-W)/R  where W=winRate, R=avgWin/avgLoss.
     *
     * Returns the half-Kelly fraction by default (standard practice to
     * reduce volatility while preserving growth properties).
     *
     * @param {number} winRate    - fraction of winning trades (0–1)
     * @param {number} avgWin     - average profit on a winning trade (positive)
     * @param {number} avgLoss    - average loss on a losing trade (positive)
     * @param {number} [fraction] - Kelly multiplier, default 0.5 (half-Kelly)
     * @returns {number}  suggested capital fraction to risk (clamped 0–1)
     */
    kelly(winRate, avgWin, avgLoss, fraction = 0.5) {
        const W = _n(winRate);
        const R = _n(avgLoss) > 0 ? _n(avgWin) / _n(avgLoss) : 0;
        if (R <= 0) return 0;
        const full = W - ((1 - W) / R);
        return Math.min(1, Math.max(0, full * fraction));
    },

    /**
     * Annualised volatility of a return series.
     * Assumes each return is one trading period.
     *
     * @param {number[]} returnValues
     * @param {number}   [periodsPerYear]  - default 252 (daily bars)
     * @returns {number}  annualised volatility as a decimal (e.g. 0.18 = 18%)
     */
    annualisedVolatility(returnValues, periodsPerYear = 252) {
        const { std } = _moments((returnValues || []).map(Number).filter(Number.isFinite));
        return std * Math.sqrt(periodsPerYear);
    },

    /**
     * Annualised Sharpe ratio (risk-free rate assumed 0).
     *
     * @param {number[]} returnValues
     * @param {number}   [periodsPerYear]
     * @returns {number}
     */
    sharpe(returnValues, periodsPerYear = 252) {
        const clean = (returnValues || []).map(Number).filter(Number.isFinite);
        const { mean, std } = _moments(clean);
        if (std === 0) return 0;
        return (mean / std) * Math.sqrt(periodsPerYear);
    },

    /**
     * Sortino ratio — like Sharpe but only penalises downside volatility.
     * Better metric for asymmetric return distributions.
     *
     * @param {number[]} returnValues
     * @param {number}   [periodsPerYear]
     * @param {number}   [targetReturn]   - minimum acceptable return per period, default 0
     * @returns {number}
     */
    sortino(returnValues, periodsPerYear = 252, targetReturn = 0) {
        const clean   = (returnValues || []).map(Number).filter(Number.isFinite);
        if (clean.length === 0) return 0;
        const mean    = clean.reduce((s, v) => s + v, 0) / clean.length;
        const downDev = clean
            .filter((v) => v < targetReturn)
            .map((v) => Math.pow(v - targetReturn, 2));
        if (downDev.length === 0) return 0;
        const semiStd = Math.sqrt(downDev.reduce((s, v) => s + v, 0) / clean.length);
        if (semiStd === 0) return 0;
        return ((mean - targetReturn) / semiStd) * Math.sqrt(periodsPerYear);
    },

    /**
     * Calmar ratio — annualised return divided by maximum drawdown.
     * Measures return per unit of worst-case drawdown experienced.
     *
     * @param {number}   annualisedReturn  - decimal (e.g. 0.25 = 25%)
     * @param {number}   maxDrawdownPct    - as a positive percentage (e.g. 12.5)
     * @returns {number}
     */
    calmar(annualisedReturn, maxDrawdownPct) {
        const dd = _n(maxDrawdownPct);
        if (dd <= 0) return 0;
        return _n(annualisedReturn) / (dd / 100);
    },

    /**
     * Fixed fractional position size.
     * Given account equity and a defined risk per trade, compute the
     * maximum number of units to trade.
     *
     * @param {number} equity         - current account equity
     * @param {number} riskFraction   - fraction of equity to risk (0–1), e.g. 0.01 = 1%
     * @param {number} stopDistancePerUnit - dollar risk per unit (e.g. price - stop price)
     * @returns {number} number of units (floored to whole units)
     */
    positionSize(equity, riskFraction, stopDistancePerUnit) {
        const risk = _n(equity) * Math.min(1, Math.max(0, _n(riskFraction)));
        const dist = _n(stopDistancePerUnit);
        if (dist <= 0) return 0;
        return Math.floor(risk / dist);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — rolling
// Sliding-window statistics over time-series arrays.
// All use an O(n) online algorithm (running moments) — no inner loops.
// ─────────────────────────────────────────────────────────────────────────────

const rolling = {

    /**
     * Rolling mean over a return or price series.
     *
     * @param {Array<{ time: number, value: number }>} series
     * @param {number} window
     * @returns {Array<{ time: number, mean: number }>}
     */
    mean(seriesArr, window = 20) {
        if (!Array.isArray(seriesArr) || seriesArr.length < window) return [];
        const out  = [];
        let sum    = 0;
        for (let i = 0; i < seriesArr.length; i++) {
            const v = _n(seriesArr[i]?.value);
            sum += v;
            if (i >= window) sum -= _n(seriesArr[i - window]?.value);
            if (i >= window - 1) out.push({ time: seriesArr[i].time, mean: sum / window });
        }
        return out;
    },

    /**
     * Rolling annualised Sharpe ratio.
     * Uses online variance computation for O(n) performance.
     *
     * @param {Array<{ time: number, value: number }>} returns
     * @param {number} window
     * @param {number} [periodsPerYear]
     * @returns {Array<{ time: number, sharpe: number }>}
     */
    sharpe(returns, window = 20, periodsPerYear = window) {
        if (!Array.isArray(returns) || returns.length < window) return [];
        const out   = [];
        let sum     = 0;
        let sumSq   = 0;
        for (let i = 0; i < returns.length; i++) {
            const v = _n(returns[i]?.value);
            sum   += v;
            sumSq += v * v;
            if (i >= window) {
                const old = _n(returns[i - window]?.value);
                sum   -= old;
                sumSq -= old * old;
            }
            if (i >= window - 1) {
                const n        = window;
                const mean     = sum / n;
                const variance = Math.max(0, (sumSq / n) - (mean * mean));
                const std      = Math.sqrt(variance);
                const sharpe   = std === 0 ? 0 : (mean / std) * Math.sqrt(periodsPerYear);
                out.push({ time: returns[i].time, sharpe });
            }
        }
        return out;
    },

    /**
     * Rolling standard deviation (volatility) of a return series.
     *
     * @param {Array<{ time: number, value: number }>} returns
     * @param {number} window
     * @returns {Array<{ time: number, vol: number }>}
     */
    volatility(returns, window = 20) {
        if (!Array.isArray(returns) || returns.length < window) return [];
        const out   = [];
        let sum     = 0;
        let sumSq   = 0;
        for (let i = 0; i < returns.length; i++) {
            const v = _n(returns[i]?.value);
            sum   += v;
            sumSq += v * v;
            if (i >= window) {
                const old = _n(returns[i - window]?.value);
                sum   -= old;
                sumSq -= old * old;
            }
            if (i >= window - 1) {
                const n        = window;
                const mean     = sum / n;
                const variance = Math.max(0, (sumSq / n) - (mean * mean));
                out.push({ time: returns[i].time, vol: Math.sqrt(variance) });
            }
        }
        return out;
    },

    /**
     * Rolling beta against a benchmark return series.
     * Beta = Cov(strategy, benchmark) / Var(benchmark).
     *
     * @param {Array<{ time: number, value: number }>} strategyReturns
     * @param {Array<{ time: number, value: number }>} benchmarkReturns
     * @param {number} window
     * @returns {Array<{ time: number, beta: number }>}
     */
    beta(strategyReturns, benchmarkReturns, window = 20) {
        const s = strategyReturns  || [];
        const b = benchmarkReturns || [];
        const len = Math.min(s.length, b.length);
        if (len < window) return [];

        const out = [];
        for (let i = window - 1; i < len; i++) {
            const sSlice = s.slice(i - window + 1, i + 1).map((v) => _n(v?.value));
            const bSlice = b.slice(i - window + 1, i + 1).map((v) => _n(v?.value));
            const { mean: sm } = _moments(sSlice);
            const { mean: bm, variance: bVar } = _moments(bSlice);
            if (bVar === 0) { out.push({ time: s[i].time, beta: 0 }); continue; }
            let cov = 0;
            for (let j = 0; j < window; j++) cov += (sSlice[j] - sm) * (bSlice[j] - bm);
            cov /= window;
            out.push({ time: s[i].time, beta: cov / bVar });
        }
        return out;
    },

    /**
     * Rolling maximum drawdown over a window of equity points.
     *
     * @param {Array<{ time: number, equity: number }>} equityCurve
     * @param {number} window
     * @returns {Array<{ time: number, maxDD: number }>}
     */
    maxDrawdown(equityCurve, window = 20) {
        if (!Array.isArray(equityCurve) || equityCurve.length < window) return [];
        const out = [];
        for (let i = window - 1; i < equityCurve.length; i++) {
            const slice = equityCurve.slice(i - window + 1, i + 1);
            let peak    = slice[0].equity;
            let maxDD   = 0;
            for (const p of slice) {
                if (p.equity > peak) peak = p.equity;
                const dd = peak > 0 ? ((p.equity / peak) - 1) * 100 : 0;
                if (dd < maxDD) maxDD = dd;
            }
            out.push({ time: equityCurve[i].time, maxDD });
        }
        return out;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — bar
// OHLCV bar-level calculations.
// ─────────────────────────────────────────────────────────────────────────────

const bar = {

    /**
     * Average True Range (ATR) — Wilder's smoothed version.
     * Measures market volatility in price units.
     *
     * @param {object[]} bars   - must have { high, low, close }
     * @param {number}   period
     * @returns {Array<{ time: number, atr: number }>}
     */
    atr(bars, period = 14) {
        if (!Array.isArray(bars) || bars.length < period + 1) return [];
        const trs = [];
        for (let i = 1; i < bars.length; i++) {
            const h  = _n(bars[i].high);
            const l  = _n(bars[i].low);
            const pc = _n(bars[i - 1].close);
            trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        }
        // Seed with simple average, then apply Wilder's smoothing
        let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
        const out = [];
        for (let i = period; i < trs.length; i++) {
            atr = (atr * (period - 1) + trs[i]) / period;
            out.push({ time: _n(bars[i + 1]?.time), atr });
        }
        return out;
    },

    /**
     * Volume Weighted Average Price (VWAP) for a session.
     * Resets each time the provided bars represent a new session.
     * Typically called with intraday bars for a single trading day.
     *
     * @param {object[]} bars  - must have { time, high, low, close, volume }
     * @returns {Array<{ time: number, vwap: number }>}
     */
    vwap(bars) {
        if (!Array.isArray(bars) || bars.length === 0) return [];
        let cumPV  = 0;
        let cumVol = 0;
        return bars.map((b) => {
            const typical = (_n(b.high) + _n(b.low) + _n(b.close)) / 3;
            const vol     = _n(b.volume);
            cumPV  += typical * vol;
            cumVol += vol;
            return { time: _n(b.time), vwap: cumVol > 0 ? cumPV / cumVol : typical };
        });
    },

    /**
     * Bar range as a percentage of close price.
     * Useful for quickly filtering high-volatility bars.
     *
     * @param {object} b  - must have { high, low, close }
     * @returns {number}  range % (e.g. 1.5 = 1.5%)
     */
    rangePct(b) {
        const c = _n(b?.close);
        if (c <= 0) return 0;
        return ((_n(b.high) - _n(b.low)) / c) * 100;
    },

    /**
     * Detect overnight / session gaps between consecutive bars.
     * Returns only gaps above the minGapPct threshold.
     *
     * @param {object[]} bars
     * @param {number}   [minGapPct]  - minimum gap size in %, default 0.1
     * @returns {Array<{ time: number, gapPct: number, direction: "up"|"down" }>}
     */
    gaps(bars, minGapPct = 0.1) {
        if (!Array.isArray(bars) || bars.length < 2) return [];
        const out = [];
        for (let i = 1; i < bars.length; i++) {
            const prevClose = _n(bars[i - 1].close);
            const curOpen   = _n(bars[i].open);
            if (prevClose <= 0) continue;
            const gapPct = ((curOpen - prevClose) / prevClose) * 100;
            if (Math.abs(gapPct) >= minGapPct) {
                out.push({ time: _n(bars[i].time), gapPct, direction: gapPct > 0 ? "up" : "down" });
            }
        }
        return out;
    },

    /**
     * Identify inside bars (high < prev high AND low > prev low).
     * A common pattern preceding breakouts.
     *
     * @param {object[]} bars
     * @returns {Array<{ time: number, index: number }>}
     */
    insideBars(bars) {
        if (!Array.isArray(bars) || bars.length < 2) return [];
        const out = [];
        for (let i = 1; i < bars.length; i++) {
            if (_n(bars[i].high) < _n(bars[i - 1].high) && _n(bars[i].low) > _n(bars[i - 1].low)) {
                out.push({ time: _n(bars[i].time), index: i });
            }
        }
        return out;
    },

    /**
     * Simple Pivot Points (Classic / Floor pivot).
     * PP, R1, R2, S1, S2 calculated from a prior session's OHLC.
     *
     * @param {{ high: number, low: number, close: number }} prevBar
     * @returns {{ pp: number, r1: number, r2: number, s1: number, s2: number }}
     */
    pivotPoints(prevBar) {
        const h  = _n(prevBar?.high);
        const l  = _n(prevBar?.low);
        const c  = _n(prevBar?.close);
        const pp = (h + l + c) / 3;
        return {
            pp,
            r1: (2 * pp) - l,
            r2: pp + (h - l),
            s1: (2 * pp) - h,
            s2: pp - (h - l)
        };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — format
// Display formatting and report assembly.
// ─────────────────────────────────────────────────────────────────────────────

const format = {

    /**
     * Format a number as a currency string.
     *
     * @param {number} value
     * @param {string} [currency]  - ISO 4217, default "USD"
     * @param {string} [locale]    - BCP 47 locale tag, default "en-US"
     * @returns {string}
     */
    currency(value, currency = "USD", locale = "en-US") {
        return new Intl.NumberFormat(locale, {
            style:    "currency",
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(_n(value));
    },

    /**
     * Format a decimal as a percentage string with configurable precision.
     *
     * @param {number} value       - decimal (0.05 = 5%)  OR  percentage (5 = 5%)
     * @param {number} [decimals]  - decimal places, default 2
     * @param {boolean} [isAlready] - true if value is already a percentage, default false
     * @returns {string}
     */
    percent(value, decimals = 2, isAlready = false) {
        const v = isAlready ? _n(value) : _n(value) * 100;
        return `${v.toFixed(decimals)}%`;
    },

    /**
     * Human-readable duration from milliseconds.
     * e.g. 90061000 → "1d 1h 1m 1s"
     *
     * @param {number} ms
     * @returns {string}
     */
    duration(ms) {
        const t = Math.abs(_n(ms));
        const d = Math.floor(t / 86_400_000);
        const h = Math.floor((t % 86_400_000) / 3_600_000);
        const m = Math.floor((t % 3_600_000)  / 60_000);
        const s = Math.floor((t % 60_000)     / 1000);
        return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(" ") || "0s";
    },

    /**
     * Assemble a complete, self-contained analytics report object.
     * All heavy computation is delegated to the other namespaces — this
     * function only assembles the pieces and is the canonical single call
     * for BacktestManager, the live engine, or any diagnostics endpoint.
     *
     * @param {object}   meta          - run identity (id, strategyId, symbol, etc.)
     * @param {object[]} tradeList     - raw trade array
     * @param {number}   initialCapital
     * @param {object}   [supplement]  - optional grademark/broker stats
     * @param {object}   [opts]
     * @param {number}   [opts.rollingWindow]   - default 20
     * @param {number}   [opts.periodsPerYear]  - default 252
     * @param {number}   [opts.fallbackTs]      - fallback timestamp
     * @param {boolean}  [opts.includeTrades]   - include raw trades in output
     * @returns {AnalyticsReport}
     */
    buildReport(meta, tradeList, initialCapital, supplement = {}, opts = {}) {
        const window         = Math.max(2, _n(opts.rollingWindow, 20));
        const periodsPerYear = _n(opts.periodsPerYear, 252);
        const fallbackTs     = _n(opts.fallbackTs, Date.now());
        const safe           = Array.isArray(tradeList) ? tradeList : [];

        const stats    = trades.computeStats(safe, initialCapital, supplement);
        const allSeries = series.all(initialCapital, safe, fallbackTs);
        const ret      = allSeries.returns;

        const rollingData = {
            sharpe:   rolling.sharpe(ret, window, periodsPerYear),
            vol:      rolling.volatility(ret, window),
            maxDD:    rolling.maxDrawdown(allSeries.equityCurve, window)
        };

        const riskData = {
            var95:    risk.var(ret.map((r) => r.value), 0.95),
            cvar95:   risk.cvar(ret.map((r) => r.value), 0.95),
            annVol:   risk.annualisedVolatility(ret.map((r) => r.value), periodsPerYear),
            sharpe:   risk.sharpe(ret.map((r) => r.value), periodsPerYear),
            sortino:  risk.sortino(ret.map((r) => r.value), periodsPerYear),
            calmar:   risk.calmar(stats.raw.roiPercent / 100, stats.raw.maxDrawdownPercent),
            kelly:    risk.kelly(stats.raw.winRate / 100, stats.raw.avgWin, stats.raw.avgLoss)
        };

        const streakData   = trades.streaks(safe);
        const holdTimeData = trades.avgHoldTime(safe);

        return {
            meta,
            performance:    stats,
            performanceRaw: stats.raw,
            risk:           riskData,
            streaks:        streakData,
            holdTime:       holdTimeData,
            equityCurve:    allSeries.equityCurve,
            analytics: {
                drawdownCurve:   allSeries.drawdownCurve,
                underwaterCurve: allSeries.underwaterCurve,
                returns:         ret,
                rolling:         rollingData
            },
            trades: opts.includeTrades ? safe : []
        };
    }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { trades, series, risk, rolling, bar, format };