"use strict";

const dataForge = require('data-forge');
const { backtest, analyze } = require('grademark');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger');
const broker = require('../broker/twelvedata');

/**
 * @class BacktestManager
 * @description Bridges functional Data-Forge streams with stateful Strategy instances.
 */
class BacktestManager {
    constructor() {
        this.storagePath = path.resolve(__dirname, '../data/backtests');
        this._ensureStorageDirectory();
    }

    /**
     * @public
     * Main execution entry point.
     * @param {BaseStrategy} strategy - The strategy instance to test.
     * @param {Object} options - { symbol, interval, initialCapital, file }
     */
    async run(strategy, options = {}) {
        const runtimeId = uuidv4();
        const startMs = Date.now();

        try {
            // 1. Prepare Environment
            this._prepareStrategy(strategy);
            
            // 2. Data Acquisition & Normalization
            const bars = await this._loadData(options);
            if (bars.length < strategy.lookback + 20) {
                throw new Error(`Insufficient data: ${bars.length} bars found.`);
            }

            const df = new dataForge.DataFrame(bars).setIndex("time");

            logger.info(`🚀 [BACKTEST_START] ${runtimeId} | Strat: ${strategy.name} | Symbol: ${strategy.symbol}`);

            // 3. Core Simulation Loop
            const trades = this._executeSimulation(strategy, df);

            // 4. Analytics & Reporting
            const initialCapital = Number(options.initialCapital) || 10000;
            const stats = analyze(initialCapital, trades);
            const report = this._generateReport({
                runtimeId, strategy, startMs, initialCapital, trades, stats, df
            });

            await this._persistReport(report);
            return report;

        } catch (err) {
            logger.error(`🔴 [BACKTEST_FAILED] ${runtimeId} | ${err.message}`);
            throw err;
        }
    }

    /**
     * @private
     * Hardens the strategy instance for a clean simulation run.
     */
    _prepareStrategy(strategy) {
        strategy.initParams(); // Ensure schema defaults are loaded
        strategy.setMode('BACKTEST');
        strategy.enabled = true;
        strategy.position = null; 
        strategy.store = { candleHistory: [], activeCandle: null }; // Wipe stale data
        strategy.lastExecutedCandleTime = null;
    }

    /**
     * @private
     * The simulation engine. Bridges Grademark callbacks to Strategy onPrice.
     */
    _executeSimulation(strategy, df) {
        return backtest({
            entryRule: (enter, { bar }) => {
                const index = df.getIndex().indexOf(bar.time);
                const isWarmup = index < strategy.lookback;

                // Process the bar
                strategy.onPrice(bar, isWarmup);
                const signal = strategy.pendingSignal;

                if (isWarmup || !signal) return;

                // Map signals to Grademark actions
                if (signal.action === 'ENTER_LONG') enter({ direction: 'long' });
                if (signal.action === 'ENTER_SHORT') enter({ direction: 'short' });
            },

            exitRule: (exit) => {
                const signal = strategy.pendingSignal;
                if (signal?.action.startsWith('EXIT_')) exit();
            },

            // Stop Loss (Engine-level safety)
            stopLoss: ({ direction, entryPrice }) => {
                const slPct = (strategy.params?.stopLoss ?? 0) / 100;
                if (slPct <= 0) return undefined;
                return direction === 'long' 
                    ? entryPrice * (1 - slPct) 
                    : entryPrice * (1 + slPct);
            }
        }, df);
    }

    /**
     * @private
     * Normalizes data from CSV or API into standard OHLCV format.
     */
    async _loadData(options) {
        let rawData;
        if (options.file?.path) {
            rawData = dataForge.readFileSync(options.file.path).fromCSV().toArray();
        } else {
            rawData = await broker.fetchHistory({
                symbol: options.symbol,
                interval: options.interval || '1min',
                outputsize: options.outputsize || 5000
            });
        }

        return rawData.map(row => ({
            time: this._normalizeTime(row),
            open: parseFloat(row.open || row.Open),
            high: parseFloat(row.high || row.High),
            low: parseFloat(row.low || row.Low),
            close: parseFloat(row.close || row.Close),
            volume: parseFloat(row.volume || row.Volume || 0)
        })).filter(b => !isNaN(b.time) && b.close > 0);
    }

    _normalizeTime(row) {
        const t = row.time || row.timestamp || row.datetime || row.Date;
        let ms = isNaN(t) ? Date.parse(t) : Number(t);
        return ms < 1e10 ? ms * 1000 : ms; // Ensure milliseconds
    }

    _generateReport({ runtimeId, strategy, startMs, initialCapital, trades, stats, df }) {
        // Equity Curve DSA: Cumulative sum of trade profits
        let cumulativeProfit = 0;
        const equityCurve = trades.map(t => {
            cumulativeProfit += t.profit;
            return { time: t.exitTime, equity: initialCapital + cumulativeProfit };
        });

        return {
            meta: {
                id: runtimeId,
                strategy: strategy.name,
                symbol: strategy.symbol,
                timeframe: strategy.timeframe,
                executedAt: new Date().toISOString()
            },
            summary: {
                initialCapital,
                finalEquity: initialCapital + cumulativeProfit,
                netProfit: cumulativeProfit,
                winRate: (stats.winRate || 0) * 100,
                totalTrades: trades.length,
                maxDrawdown: stats.maxDrawdown || 0,
                sharpeRatio: stats.sharpe || 0
            },
            equityCurve
        };
    }

    async _persistReport(report) {
        const p = path.join(this.storagePath, `${report.meta.id}.json`);
        fs.writeFileSync(p, JSON.stringify(report, null, 2));
    }

    _ensureStorageDirectory() {
        if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
    }
}

module.exports = new BacktestManager();