"use strict";

const dataForge = require('data-forge');
const { backtest, analyze } = require('grademark');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const broker = require('../broker/twelvedata');

class BacktestManager {
    constructor() {
        this.storagePath = path.resolve(__dirname, '../data/backtests');
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    /**
     * @public
     * EXECUTION: Run a simulation with strict data ordering and automated persistence.
     */
    async run(strategyInstance, options = {}) {
        const runtimeId = uuidv4();
        const startTime = Date.now();
        const strategyId = strategyInstance.id || 'anonymous_strategy';

        logger.info(`🧪 [SIMULATION_START] ID: ${runtimeId} | Strategy: ${strategyId}`);

        try {
            // 1. DATA ACQUISITION & NORMALIZATION
            const history = await this._ingestData(options);
            const df = new dataForge.DataFrame(history);
            
            const timeline = {
                start: new Date(history[0].time).toISOString(),
                end: new Date(history[history.length - 1].time).toISOString()
            };

            // 2. THE SIMULATION BRIDGE
            // We override buy/sell with Grademark's enter/exit functions
            const trades = backtest({
                entryRule: (enter, bar) => {
                    strategyInstance.buy = (p) => enter(p?.price || bar.close);
                    // Standardize: backtesters use bars, live uses ticks. 
                    // We map bar to tick schema for internal strategy logic compatibility.
                    strategyInstance.onPrice(bar, false); 
                },
                exitRule: (exit, bar) => {
                    strategyInstance.sell = (p) => exit(p?.price || bar.close);
                    strategyInstance.onPrice(bar, false);
                }
            }, df);

            // 3. ANALYTICS & METRICS GENERATION
            const initialCapital = parseFloat(options.initialCapital) || 10000;
            const stats = analyze(initialCapital, trades);

            const report = this._generateFinalReport({
                runtimeId,
                strategyId,
                startTime,
                initialCapital,
                trades,
                stats,
                timeline,
                options
            });

            // 4. PERSISTENCE (Store results for UI/Audit)
            await this._persistResults(report);

            logger.info(`✅ [SIMULATION_COMPLETE] ROI: ${report.performance.roi}% | Trades: ${report.performance.totalTrades}`);
            return report;

        } catch (err) {
            logger.error(`❌ [SIMULATION_FAILED] ${err.message}`);
            throw err;
        }
    }

    /**
 * @private
 * DYNAMIC DATA INGESTION: Standardizes disparate sources into a unified OHLCV format.
 * Optimized to skip sorting for pre-validated API streams.
 */
async _ingestData(options) {
    let raw;

    // --- CASE 1: LOCAL FILE (External/Untrusted) ---
    if (options.file) {
        this.log.info(`📂 Ingesting Local Dataset: ${options.file.path}`);
        
        const content = fs.readFileSync(options.file.path, 'utf8');
        
        // Use dataForge to parse and then force-normalize fields
        raw = dataForge.fromCSV(content)
            .toArray()
            .map(row => ({
                time: row.time ? parseInt(row.time) : new Date(row.datetime || row.timestamp || row.Date).getTime(),
                open: parseFloat(row.open || row.Open),
                high: parseFloat(row.high || row.High),
                low: parseFloat(row.low || row.Low),
                close: parseFloat(row.close || row.Close),
                price: parseFloat(row.close || row.Close), // Mapping close as the default execution price
                volume: parseFloat(row.volume || row.Volume || 0)
            }))
            // Professional Requirement: Filter out malformed entries to prevent simulation bias
            .filter(d => !isNaN(d.time) && !isNaN(d.close))
            // Sort ascending: CSV exports are frequently descending (newest first)
            .sort((a, b) => a.time - b.time);

    // --- CASE 2: BROKER API (Internal/Trusted) ---
    } else {
        this.log.info(`☁️ Ingesting Remote Dataset: ${options.symbol} [${options.interval}]`);
        
        raw = await broker.fetchHistory({
            symbol: options.symbol,
            interval: options.interval || '1h',
            outputsize: options.outputsize || 1000
        });

        // Optimization: TwelveDataBroker already handles normalization and sorting.
        // Returning raw directly saves O(n log n) CPU cycles and memory copying.
    }

    if (!raw || raw.length === 0) {
        throw new Error(`Data Access Failure: No valid records found for ${options.symbol || 'CSV'}`);
    }

    return raw;
}

    /**
     * @private
     * Industry-grade Metrics Formatting
     */
    _generateFinalReport(ctx) {
        const executionSeconds = ((Date.now() - ctx.startTime) / 1000).toFixed(2);
        
        return {
            meta: {
                id: ctx.runtimeId,
                strategy: ctx.strategyId,
                timestamp: new Date().toISOString(),
                execution_time: `${executionSeconds}s`
            },
            config: {
                symbol: ctx.options.symbol,
                interval: ctx.options.interval,
                timeframe: `${ctx.timeline.start} to ${ctx.timeline.end}`,
                initial_capital: ctx.initialCapital
            },
            performance: {
                netProfit: ctx.stats.profit.toFixed(2),
                roi: ((ctx.stats.profit / ctx.initialCapital) * 100).toFixed(2),
                maxDrawdown: ctx.stats.maxDrawdown.toFixed(2),
                totalTrades: ctx.trades.length,
                winRate: ctx.trades.length > 0 
                    ? ((ctx.trades.filter(t => t.profit > 0).length / ctx.trades.length) * 100).toFixed(2) 
                    : "0.00",
                expectancy: ctx.trades.length > 0 ? (ctx.stats.profit / ctx.trades.length).toFixed(2) : 0
            },
            trades: ctx.options.includeTrades ? ctx.trades : []
        };
    }

    /**
     * @private
     * Saves backtest as JSON (Full Report) and CSV (Trade Log)
     */
    async _persistResults(report) {
        const baseFile = path.join(this.storagePath, `${report.meta.id}`);
        
        // Save JSON Metadata
        fs.writeFileSync(`${baseFile}.json`, JSON.stringify(report, null, 2));

        // Save Trade CSV for external analysis (Excel/Python)
        if (report.trades.length > 0) {
            const tradeDf = new dataForge.DataFrame(report.trades);
            await tradeDf.asCSV().writeFile(`${baseFile}_trades.csv`);
        }
    }
}

module.exports = new BacktestManager();