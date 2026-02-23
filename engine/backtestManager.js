const dataForge = require("data-forge");
const { backtest, analyze } = require("grademark");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");

const logger = require("@utils/logger");
const broker = require("@broker/twelvedata");
const db = require("@core/services/postgres");
const { compile } = require("@core/services/strategyCompiler");
const { BACKTEST } = require("@config/constants");

/**
 * @class BacktestManager
 * @description Standardized orchestrator for strategy backtesting.
 * - Single-pass execution (Strategy + Simulation run together).
 * - Proper state management for stateful strategies.
 * - Grademark-driven performance analysis.
 */
class BacktestManager {
    constructor() {
        this.storagePath = path.resolve(__dirname, "../data/backtests");
        this._ensureStorageDirectory();
    }

    _ensureStorageDirectory() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
            logger.info(`Created backtest results directory -> ${this.storagePath}`);
        }
    }

    /**
     * Execute a complete backtest run
     */
    async run(strategy, options = {}) {
        const runtimeId = crypto.randomUUID().slice(0, 8);
        const startMs = Date.now();

        const compiled = compile(strategy);
        if (!compiled.ok) {
            throw new Error(`STRATEGY_COMPILE_FAILED: ${compiled.reason}`);
        }

        logger.info(`Backtest start [${runtimeId}] - strategy=${strategy?.name || "unknown"} id=${strategy?.id || "n/a"}`);

        try {
            // 1. Load and Clean Data
            logger.info(`Loading data (file:${!!options.file?.path} symbol:${!!options.symbol})...`);
            const bars = await this._loadAndNormalizeData(options);
            logger.info(`Loaded and normalized ${bars.length} bars.`);

            // 2. Create the DataFrame and bake it into memory
            let df = new dataForge.DataFrame(bars)
                .cast()
                .orderBy(row => row.time)
                .bake();

            logger.info(`DataFrame baked -> ${df.count()} bars. Starting simulation...`);

            // 3. Simulation Pass
            const trades = this._runGrademarkSimulation(df, strategy, options) || [];
            logger.info(`Simulation finished -> ${trades.length} trades generated.`);

            // 4. Analysis Guard
            const initialCapital = Number(options.initialCapital) || 10000;
            logger.info(`Analyzing results with initial capital = ${initialCapital}`);
            let stats = { profit: 0, maxDrawdownPct: 0 };

            if (trades.length > 0) {
                const tradesDf = new dataForge.DataFrame(trades);
                stats = analyze(initialCapital, tradesDf.toArray());
                logger.info(`Analysis complete -> profit=${(stats.profit || 0).toFixed(2)} maxDD%=${(stats.maxDrawdownPct || 0).toFixed(2)} sharpe=${(stats.sharpeRatio || "N/A")}`);
            } else {
                logger.info("No trades to analyze.");
            }

            // 5. Final Report
            const report = this._buildReport({
                runtimeId,
                strategy,
                startMs,
                initialCapital,
                trades,
                stats,
                df,
                options
            });

            await this._saveReport(report);

            const savedPath = path.join(this.storagePath, `${report.meta.id}.json`);
            logger.info(`Report saved -> ${savedPath}`);
            logger.info(`Backtest complete [${runtimeId}] (duration: ${((Date.now() - startMs) / 1000).toFixed(2)}s)`);

            return report;

        } catch (err) {
            logger.error(`BACKTEST FAILED -> ${err.message}`);
            throw err;
        }
    }

    async _loadAndNormalizeData(options) {
        let rawRows;
        if (options.file?.path) {
            rawRows = await this._readCsv(options.file.path);
        } else if (options.symbol && options.interval) {
            rawRows = await this._fetchFromBroker(options);
        } else {
            throw new Error("Missing data source: provide 'file' or 'symbol/interval'");
        }
        const bars = this._normalizeBars(rawRows);
        const ranged = this._applyRange(bars, options);
        if (!Array.isArray(ranged) || ranged.length === 0) {
            throw new Error("No bars in selected range.");
        }
        return ranged;
    }

    async _readCsv(filePath) {
        const maxMb = Number(process.env.BACKTEST_MAX_MB || 50);
        try {
            const stat = fs.statSync(filePath);
            const maxBytes = maxMb * 1024 * 1024;
            if (stat.size > maxBytes) {
                throw new Error(`Dataset too large (>${maxMb}MB)`);
            }
        } catch (err) {
            if (err.code === "ENOENT") throw err;
        }
        const input = fs.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input, crlfDelay: Infinity });

        let headers = null;
        const rows = [];

        for await (const line of rl) {
            if (!line || !line.trim()) continue;
            if (!headers) {
                headers = this._parseCsvLine(line);
                continue;
            }
            const values = this._parseCsvLine(line);
            const row = {};
            for (let i = 0; i < headers.length; i += 1) {
                row[headers[i]] = values[i] ?? "";
            }
            rows.push(row);
        }

        return rows;
    }

    _parseCsvLine(line) {
        const out = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    cur += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }
            if (ch === "," && !inQuotes) {
                out.push(cur);
                cur = "";
                continue;
            }
            cur += ch;
        }
        out.push(cur);
        return out.map((v) => String(v).trim());
    }

    async _fetchFromBroker(options) {
        return await broker.fetchHistory({
            symbol: options.symbol,
            interval: options.interval || "1m",
            outputsize: options.outputsize || 5000
        });
    }

    _normalizeBars(rawRows) {
        if (!Array.isArray(rawRows)) return [];
        return rawRows
            .map((row) => {
                const rawTime = row.time || row.Time || row.timestamp || row.datetime || row.Date || row.at;
                let timeMs = NaN;

                if (rawTime) {
                    const num = Number(rawTime);
                    timeMs = !isNaN(num) ? (num < 1e11 ? num * 1000 : num) : Date.parse(rawTime);
                }

                if (isNaN(timeMs)) return null;

                const bar = {
                    time: timeMs,
                    open: parseFloat(row.open || row.Open || 0),
                    high: parseFloat(row.high || row.High || 0),
                    low: parseFloat(row.low || row.Low || 0),
                    close: parseFloat(row.close || row.Close || 0),
                    volume: parseFloat(row.volume || row.Volume || 0)
                };

                return bar.close > 0 ? bar : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);
    }

    _applyRange(bars = [], options = {}) {
        if (!Array.isArray(bars) || bars.length === 0) return bars;
        const mode = String(options.rangeMode || "points").toLowerCase();
        if (mode === "dates") {
            const start = Number(options.rangeStart);
            const end = Number(options.rangeEnd);
            const hasStart = Number.isFinite(start);
            const hasEnd = Number.isFinite(end);
            if (!hasStart && !hasEnd) return bars;
            const minTs = hasStart ? start : -Infinity;
            const maxTs = hasEnd ? end : Infinity;
            const [lo, hi] = minTs <= maxTs ? [minTs, maxTs] : [maxTs, minTs];
            return bars.filter((b) => Number(b.time) >= lo && Number(b.time) <= hi);
        }

        const points = Number(options.rangePoints || options.outputsize || 0);
        if (Number.isFinite(points) && points > 0) {
            return bars.slice(-Math.floor(points));
        }
        return bars;
    }

    /**
     * Unified Simulation Pass
     * Standardizes how data flows into the strategy and how signals flow to the adapter.
     * Handles same-bar flip logic by coordinating exitRule and entryRule.
     */
    _runGrademarkSimulation(df, strategy, options) {
        const symbol = options.symbol || "SYMBOL";

        const normalizeSignal = (signal) => {
            if (!signal || typeof signal !== "object") return null;
            const intentRaw = signal.intent || signal.action || signal.type;
            const sideRaw = signal.side || signal.direction || signal.orderSide;
            const intent = String(intentRaw || "").toUpperCase();
            let side = String(sideRaw || "").toLowerCase();

            if (!side && (intent === "BUY" || intent === "LONG")) side = "long";
            if (!side && (intent === "SELL" || intent === "SHORT")) side = "short";
            if (side === "buy") side = "long";
            if (side === "sell") side = "short";

            return {
                intent,
                side,
                price: Number(signal.price),
                raw: signal
            };
        };

        return backtest({
            // 1. ENTRY RULE: Processes new positions and flip completions
            entryRule: (enter, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

                if (strategy._flipNext) {
                    const flipSignal = strategy.applyFlip(symbol);
                    if (flipSignal) {
                        enter({
                            direction: flipSignal.side,
                            entryPrice: flipSignal.price || bar.close
                        });
                        return;
                    }
                }

                const signal = strategy.onBar(bar);
                const normalized = normalizeSignal(signal);

                if (normalized && (normalized.intent === "ENTER" || normalized.intent === "BUY")) {
                    enter({
                        direction: normalized.side,
                        entryPrice: Number.isFinite(normalized.price) ? normalized.price : bar.close
                    });
                }
            },

            // 2. EXIT RULE: Processes closings and initiates flips
            exitRule: (exit, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

                const signal = strategy.onBar(bar);
                const normalized = normalizeSignal(signal);

                if (!normalized) return;

                const currentSide = args.position.direction;
                const isExitIntent = normalized.intent === "EXIT" || normalized.intent === "CLOSE";

                // Detection of a flip (enter signal for the opposite side)
                const isFlipIntent = normalized.intent === "ENTER" &&
                    normalized.side &&
                    normalized.side !== currentSide;

                if (isExitIntent || isFlipIntent) {
                    exit();
                    strategy.positions.close(symbol, bar.close);
                }
            },

            stopLoss: ({ direction, entryPrice }) => {
                const sl = Number(options.stopLossPercent) || 0;
                if (sl <= 0) return undefined;
                return direction === "long" ? entryPrice * (1 - sl / 100) : entryPrice * (1 + sl / 100);
            },

            takeProfit: ({ direction, entryPrice }) => {
                const tp = Number(options.takeProfitPercent) || 0;
                if (tp <= 0) return undefined;
                return direction === "long" ? entryPrice * (1 + tp / 100) : entryPrice * (1 - tp / 100);
            }
        }, df);
    }

    _buildEquityAnalytics(initialCapital, trades = [], fallbackTime = Date.now()) {
        const points = [{
            time: Number(fallbackTime),
            equity: Number(initialCapital)
        }];

        const sorted = [...trades]
            .map((t) => ({
                ...t,
                profit: Number(t?.profit || 0),
                exitTs: Number(t?.exitTime || t?.entryTime || fallbackTime)
            }))
            .filter((t) => Number.isFinite(t.exitTs))
            .sort((a, b) => a.exitTs - b.exitTs);

        let equity = Number(initialCapital);
        for (const t of sorted) {
            equity += Number.isFinite(t.profit) ? t.profit : 0;
            points.push({ time: t.exitTs, equity: Number(equity) });
        }

        let peak = points[0]?.equity || Number(initialCapital);
        const drawdownCurve = points.map((p) => {
            if (p.equity > peak) peak = p.equity;
            const drawdown = peak > 0 ? ((p.equity / peak) - 1) * 100 : 0;
            return { time: p.time, drawdown };
        });

        const returns = [];
        for (let i = 1; i < points.length; i += 1) {
            const prev = Number(points[i - 1].equity || 0);
            const cur = Number(points[i].equity || 0);
            if (prev !== 0) {
                returns.push({ time: points[i].time, value: (cur / prev) - 1 });
            }
        }

        const rollingWindow = 20;
        const rollingSharpe = [];
        // Dynamic-programming style rolling moments: O(n) instead of O(n*window).
        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < returns.length; i += 1) {
            const r = Number(returns[i].value || 0);
            sum += r;
            sumSq += r * r;

            if (i >= rollingWindow) {
                const old = Number(returns[i - rollingWindow].value || 0);
                sum -= old;
                sumSq -= old * old;
            }

            if (i >= rollingWindow - 1) {
                const n = rollingWindow;
                const mean = sum / n;
                const variance = Math.max(0, (sumSq / n) - (mean * mean));
                const std = Math.sqrt(variance);
                const sharpe = std === 0 ? 0 : (mean / std) * Math.sqrt(n);
                rollingSharpe.push({ time: returns[i].time, sharpe });
            }
        }

        return {
            equityCurve: points,
            drawdownCurve,
            returns,
            rollingSharpe
        };
    }

    _buildReport({ runtimeId, strategy, startMs, initialCapital, trades, stats, df, options }) {
        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        const safeTrades = Array.isArray(trades) ? trades : [];
        const wins = safeTrades.filter(t => (t.profit || 0) > 0).length;
        const winRate = safeTrades.length > 0 ? (wins / safeTrades.length) : 0;
        const grossProfit = safeTrades.filter(t => (t.profit || 0) > 0).reduce((s, t) => s + (t.profit || 0), 0);
        const grossLoss = safeTrades.filter(t => (t.profit || 0) < 0).reduce((s, t) => s + Math.abs(t.profit || 0), 0);
        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : null;
        const avgWin = wins > 0 ? (grossProfit / wins) : 0;
        const losses = safeTrades.filter(t => (t.profit || 0) < 0).length;
        const avgLoss = losses > 0 ? (grossLoss / losses) : 0;
        const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

        const analytics = this._buildEquityAnalytics(
            Number(initialCapital),
            safeTrades,
            Number(df?.first()?.time || Date.now())
        );
        const equityCurve = analytics.equityCurve;

        return {
            meta: {
                id: runtimeId,
                strategyId: strategy.id,
                strategyName: strategy.name,
                strategyVersion: strategy.version || strategy.versionTag || options.versionTag || null,
                runtimeParams: strategy.params || {},
                symbol: options.symbol || strategy.symbols?.[0] || "SYMBOL",
                timeframe: options.interval || strategy.timeframe || "1m",
                timestamp: new Date().toISOString(),
                executionTime: `${duration}s`
            },
            performance: {
                netProfit: stats.profit?.toFixed(2) ?? "0.00",
                roiPercent: (((stats.profit || 0) / initialCapital) * 100).toFixed(2),
                maxDrawdownPercent: (stats.maxDrawdownPct || 0).toFixed(2),
                totalTrades: safeTrades.length,
                winRate: safeTrades.length > 0 ? ((wins / safeTrades.length) * 100).toFixed(2) : "0.00",
                sharpeRatio: stats.sharpeRatio?.toFixed(2) ?? "N/A",
                profitFactor: profitFactor != null ? profitFactor.toFixed(2) : "N/A",
                grossProfit: grossProfit.toFixed(2),
                grossLoss: grossLoss.toFixed(2),
                avgWin: avgWin.toFixed(2),
                avgLoss: avgLoss.toFixed(2),
                expectancy: expectancy.toFixed(2)
            },
            performanceRaw: {
                netProfit: Number(stats.profit || 0),
                roiPercent: Number(((stats.profit || 0) / initialCapital) * 100),
                maxDrawdownPercent: Number(stats.maxDrawdownPct || 0),
                totalTrades: Number(safeTrades.length || 0),
                winRate: safeTrades.length > 0 ? Number((wins / safeTrades.length) * 100) : 0,
                sharpeRatio: Number(stats.sharpeRatio || 0),
                profitFactor: profitFactor != null ? Number(profitFactor) : 0,
                grossProfit: Number(grossProfit || 0),
                grossLoss: Number(grossLoss || 0),
                avgWin: Number(avgWin || 0),
                avgLoss: Number(avgLoss || 0),
                expectancy: Number(expectancy || 0)
            },
            trades: options.includeTrades ? safeTrades : [],
            equityCurve,
            analytics: {
                drawdownCurve: analytics.drawdownCurve,
                returns: analytics.returns,
                rollingSharpe: analytics.rollingSharpe
            }
        };
    }

    async _saveReport(report) {
        if (!BACKTEST.DB_REQUIRED) {
            const filepath = path.join(this.storagePath, `${report.meta.id}.json`);
            try {
                fs.writeFileSync(filepath, JSON.stringify(report));
            } catch (err) {
                logger.warn(`Backtest file save failed: ${err.message}`);
            }
        }

        if (!db.hasDbConfig()) {
            if (BACKTEST.DB_REQUIRED) throw new Error("BACKTEST_DB_REQUIRED");
            return;
        }
        try {
            const meta = report.meta || {};
            const performance = report.performance || {};
            const options = {
                symbol: meta.symbol,
                timeframe: meta.timeframe,
                executionTime: meta.executionTime
            };
            await db.query(
                `INSERT INTO backtests (id, strategy_id, strategy_name, symbol, timeframe, options, performance, report)
                 VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
                 ON CONFLICT (id) DO UPDATE
                 SET report = EXCLUDED.report,
                     performance = EXCLUDED.performance,
                     options = EXCLUDED.options,
                     created_at = NOW()`,
                [
                    String(meta.id),
                    meta.strategyId || null,
                    meta.strategyName || null,
                    meta.symbol || null,
                    meta.timeframe || null,
                    JSON.stringify(options),
                    JSON.stringify(performance),
                    JSON.stringify(report)
                ]
            );
        } catch (err) {
            logger.warn(`Backtest DB save failed: ${err.message}`);
        }
    }
}

module.exports = new BacktestManager();
