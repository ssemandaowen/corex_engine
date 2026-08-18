"use strict";

/**
 * runPipeline.js
 * 
 * Unified entry point for the signal processing pipeline.
 * Executes all three stages consistently for backtest, paper, and live modes.
 * 
 * This is the single function that processes every incoming data packet:
 * - Calls Stage 1: SignalGenerationEngine (strategy signal generation)
 * - Calls Stage 2: SignalProcessingEngine (risk/filter checks)
 * - Calls Stage 3: SignalExecutionEngine (order execution via broker)
 * 
 * Standardizes behavior across modes by passing a context object that
 * tells each stage what mode it's running in, so mode-specific features
 * can be conditionally applied.
 */

const SignalGenerationEngine = require("./SignalGenerationEngine");
const SignalProcessingEngine = require("./SignalProcessingEngine");
const SignalExecutionEngine = require("./SignalExecutionEngine");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("PIPELINE");

/**
 * Standard Context Object
 * @typedef {Object} PipelineContext
 * @property {string} source - 'bar' or 'tick' (data packet type)
 * @property {string} mode - 'BACKTEST' | 'PAPER' | 'LIVE' (execution mode)
 * @property {number} seqNum - Sequence number (bar index in backtest; monotonic counter in live)
 * @property {number} timestamp - Timestamp in ms epoch
 */

/**
 * runPipeline(runtimeId, packet, context, broker)
 * 
 * Execute the complete signal processing pipeline for a single data packet.
 * 
 * FLOW:
 * 1. Stage 1: Signal Generation
 *    - Call strategy's next() method with the market data
 *    - Returns an intent object if signal is generated, null otherwise
 * 
 * 2. Stage 2: Signal Processing
 *    - Validate intent against risk rules
 *    - Apply position sizing and filters
 *    - Returns approved intent if it passes, null otherwise
 * 
 * 3. Stage 3: Signal Execution
 *    - Place order with broker
 *    - Update positions and P&L
 *    - Emit execution events
 *    - Returns execution result
 * 
 * Each stage is independent and can be skipped if previous stage returns null.
 * 
 * @param {string} runtimeId - Unique runtime identifier
 * @param {Object} packet - Market data packet (bar or tick)
 * @param {number} packet.time - Timestamp
 * @param {number} packet.open - Opening price (for bars)
 * @param {number} packet.high - High price
 * @param {number} packet.low - Low price
 * @param {number} packet.close - Closing price
 * @param {number} packet.volume - Trade volume
 * @param {string} [packet.symbol] - Trading symbol
 * @param {Object} context - Pipeline context object
 * @param {string} context.source - 'bar' or 'tick'
 * @param {string} context.mode - 'BACKTEST' | 'PAPER' | 'LIVE'
 * @param {number} context.seqNum - Sequence number
 * @param {number} context.timestamp - Current timestamp
 * @param {Object} broker - Broker instance for execution
 * 
 * @returns {Promise<Object|null>} Execution result or null if rejected at any stage
 */
async function runPipeline(runtimeId, packet, context, broker) {
    try {
        const intent = await SignalGenerationEngine.process(runtimeId, packet, context);
        if (!intent) {
            return null;
        }

        const approved = SignalProcessingEngine.process(intent, {
            strategyId: runtimeId,
            symbol: packet.symbol
        });

        if (!approved?.accepted) {
            return null;
        }

        const signal = approved.signal;
        const enqueued = SignalExecutionEngine.enqueue(async () => {
            if (broker && typeof broker.execute === "function") {
                return await broker.execute(signal, packet);
            }
            return null;
        }, { strategyId: runtimeId, symbol: packet.symbol });

        if (!enqueued) {
            log.warn("Pipeline execution queue full", { runtimeId });
        }

        return approved;
    } catch (error) {
        log.error("Pipeline error", { runtimeId, error: error.message, stack: error.stack });
        return null;
    }
}

module.exports = runPipeline;
