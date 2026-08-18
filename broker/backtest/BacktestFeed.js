// broker/backtest/BacktestFeed.js
"use strict";

const { BACKTEST_MAX_CANDLES } = require("../../config/constants") || { BACKTEST_MAX_CANDLES: 5000 };
const dataForge = require("data-forge");
const runPipeline = require("../../engine/core/pipeline/runPipeline");
const runtimeRegistry = require("../../engine/core/runtime/RuntimeRegistry");
const { bus, EVENTS } = require("../../events/bus");

/**
 * CoreX Backtest Feed Engine
 * Synchronously replays OHLCV historical arrays into the 3-stage sandwich processing pipeline.
 */
class BacktestFeed {
    /**
     * Executes a historical data backtest simulation pass over a single asset sequence.
     * @param {string} runtimeId - Target active workspace composite identifier mapping
     * @param {Array<Object>} candles - Full raw historical vector array input ([{ open, high, low, close, volume, time }])
     */
    async runSimulation(runtimeId, candles = []) {
        const workspace = runtimeRegistry.get(runtimeId);
        
        if (!workspace) {
            throw new Error(`[BacktestFeed] Simulation aborted: Runtime ID '${runtimeId}' is not registered inside memory maps.`);
        }

        if (!Array.isArray(candles) || candles.length === 0) {
            throw new Error("[BacktestFeed] Backtest aborted: Candle source dataset array is empty.");
        }

        // 1. Data-Forge Preparation: Normalize and cap
        let df = new dataForge.DataFrame(candles)
            .cast() // Ensure numbers are numbers
            .orderBy(row => row.time);
            
        if (df.count() > BACKTEST_MAX_CANDLES) {
            df = df.tail(BACKTEST_MAX_CANDLES);
        }
        
        const evaluationDataset = df.toArray();

        // 2. Wipe state clean to guarantee zero leaks from prior backtest loops
        if (workspace.instance && typeof workspace.instance.resetState === "function") {
            workspace.instance.resetState();
        }
        if (workspace.broker && typeof workspace.broker.resetState === "function") {
            workspace.broker.resetState();
        }

        // Set workspace status to active for the duration of the stream execution
        workspace.actualState = "ACTIVE";
        
        bus.emit(EVENTS.BACKTEST.START, { runtimeId, datasetSize: evaluationDataset.length });

        try {
            // 3. Serial execution replay loop feeding candles into the engine sandwich pipeline
            for (let i = 0; i < evaluationDataset.length; i++) {
                const currentBar = evaluationDataset[i];
                
                // Format matching pure OHLCV contract standards
                const packet = {
                    symbol: workspace.symbol,
                    open: Number(currentBar.open),
                    high: Number(currentBar.high),
                    low: Number(currentBar.low),
                    close: Number(currentBar.close),
                    volume: Number(currentBar.volume || 0),
                    time: currentBar.time ? new Date(currentBar.time).getTime() : Date.now()
                };

                const context = {
                    source: "bar",
                    mode: "BACKTEST",
                    seqNum: i + 1,
                    timestamp: packet.time
                };

                // Execute the unified pipeline (all three stages in sequence)
                await runPipeline(runtimeId, packet, context, workspace.broker);
            }

        } catch (error) {
            bus.emit(EVENTS.BACKTEST.ERROR, { runtimeId, error: error.message });
            throw error;
        } finally {
            // Complete backtest loop tracking and flag strategy stop bounds
            workspace.actualState = "STOPPED";
            
            // Extract computed matrices straight out from the isolated backtest broker
            const finalPerformanceMetrics = typeof workspace.broker.getPerformanceMetrics === "function"
                ? workspace.broker.getPerformanceMetrics()
                : {};

            bus.emit(EVENTS.BACKTEST.END, { runtimeId, performance: finalPerformanceMetrics });
        }
    }
}

module.exports = new BacktestFeed();