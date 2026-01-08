const dataForge = require('data-forge');
const { backtest, analyze } = require('grademark');
const fs = require('fs');
const logger = require('../utils/logger');
const broker = require('../broker/twelvedata');

class BacktestManager {
    async run(strategyInstance, options = {}) {
        let rawData;

        // 1. DATA SELECTION
        if (options.file) {
            const content = fs.readFileSync(options.file.path, 'utf8');
            rawData = dataForge.fromCSV(content).toArray();
        } else {
            logger.info(`☁️ Backtest: Fetching from Twelve Data API [${options.symbol}]`);
            const response = await broker.fetchHistory(options.symbol, options.interval, options.outputsize);
            rawData = response || [];
        }

        if (!rawData || rawData.length === 0) throw new Error("No data found.");

        // 2. NORMALIZATION & CHRONOLOGY
        // We must map 'close' to 'price' and ensure the order is Oldest -> Newest
        const history = rawData.map(d => ({
            time: d.timestamp ? parseInt(d.timestamp) * 1000 : new Date(d.datetime).getTime(),
            open: parseFloat(d.open),
            high: parseFloat(d.high),
            low: parseFloat(d.low),
            close: parseFloat(d.close),
            price: parseFloat(d.close), // Strategy logic uses .price
            volume: parseFloat(d.volume || 0)
        })).reverse();

        const df = new dataForge.DataFrame(history);
        logger.info(`✅ Data Points Loaded: ${history.length} | Starting Backtest Engine...`);

        // 3. GRADEMARK BRIDGE (The Shadowing)
        // We redefine buy/sell on the instance ONLY for this loop
        const trades = backtest({
            entryRule: (enter, bar) => {
                // We MUST re-bind these every time because Grademark 
                // controls the 'enter' and 'exit' functions internally
                strategyInstance.buy = () => enter();
                strategyInstance.next(bar, true);
            },
            exitRule: (exit, bar) => {
                strategyInstance.sell = () => exit();
                strategyInstance.next(bar, true);
            }
        }, df);

        // 4. METRICS CALCULATION
        const stats = analyze(10000, trades);

        return {
            strategy: strategyInstance.id,
            source: options.file ? 'FILE' : 'API',
            period: { start: history[0].time, end: history[history.length - 1].time },
            metrics: {
                profit: stats.profit.toFixed(2),
                drawdown: stats.maxDrawdown.toFixed(2) + '%',
                trades: trades.length
            }
        };
    }
}

module.exports = new BacktestManager();