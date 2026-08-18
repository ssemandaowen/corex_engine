// engine/core/pipeline/SignalGenerationEngine.js
"use strict";

const RuntimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const { bus, EVENTS } = require("@events/bus");
const stateManager = require("@utils/stateController");

// Placeholder configService layer to connect your database parameters shadow store
// If you have a centralized config module, require it here.
const configService = {
    async getParamsFor(runtimeId) {
        // Reads directly from strategy_runtimes[runtimeId].params in your PostgreSQL runtime isolation schema
        const entry = RuntimeRegistry.get(runtimeId);
        return entry ? (entry.params || {}) : {};
    }
};

/**
 * CoreX Signal Generation Engine
 * Implements the sandbox tick sandwich orchestration loop for strategy instances.
 */
class SignalGenerationEngine {
    constructor() {
        // Error tracking for circuit breaker
        this._errorCounters = new Map(); // runtimeId -> { count, firstErrorAt }
        this.MAX_ERRORS = 5;             // Max errors before blowing the circuit
        this.ERROR_WINDOW_MS = 60000;    // Time window in ms (1 minute)
    }

    /**
     * Primary entry point called per tick per active runtime execution slot.
     * @param {string} runtimeId - "user::strategy_class::SYMBOL::MODE"
     * @param {Object} packet - Incoming tick pricing or candlestick frame
     * @param {Object} context - Temporal and tracking execution metadata
     * @returns {Promise<Object|null>} Frozen IntentObject contract or null if strategy passes
     */
    async process(runtimeId, packet, context) {
        const entry = RuntimeRegistry.get(runtimeId);

        // Guard: Silently discard ticks if the target runtime state has dropped or paused
        if (!entry || entry.actualState !== "ACTIVE") {
            return null;
        }

        // Circuit Breaker check: immediately discard if strategy is failing repeatedly
        if (this._isCircuitBlown(runtimeId)) {
            return null;
        }

        try {
            // Step 1: Execute Sandwich Prep Layer (Context Cascade)
            await this._preProcess(entry, packet);

            // Step 2: Execute Sandbox Evaluation Pass
            const rawSignal = this._callStrategy(entry, packet, context);

            // Step 3: Execute Sandwich Wrap & Freeze Layer
            return this._postProcess(runtimeId, rawSignal, packet, context, entry);

        } catch (error) {
            this._recordError(runtimeId, error);
            bus.emit(EVENTS.SYSTEM.ERROR, {
                source: "signal_generation_critical",
                runtimeId,
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    _isCircuitBlown(runtimeId) {
        const counter = this._errorCounters.get(runtimeId);
        if (!counter) return false;

        const now = Date.now();
        // Reset counter if the window has passed without reaching the threshold
        if (now - counter.firstErrorAt > this.ERROR_WINDOW_MS) {
            this._errorCounters.delete(runtimeId);
            return false;
        }

        return counter.count >= this.MAX_ERRORS;
    }

    _recordError(runtimeId, error) {
        const now = Date.now();
        let counter = this._errorCounters.get(runtimeId);

        if (!counter || (now - counter.firstErrorAt > this.ERROR_WINDOW_MS)) {
            counter = { count: 1, firstErrorAt: now };
        } else {
            counter.count++;
        }

        this._errorCounters.set(runtimeId, counter);

        if (counter.count >= this.MAX_ERRORS) {
            bus.emit(EVENTS.SYSTEM.ERROR, {
                source: "circuit_breaker",
                runtimeId,
                message: `Strategy ${runtimeId} disabled: exceeded threshold (${this.MAX_ERRORS} errors in ${this.ERROR_WINDOW_MS / 1000}s).`,
                fatal: true
            });
            
            // Force strategy state to ERROR in the global state controller
            stateManager.commit(runtimeId, "ERROR", { reason: "CIRCUIT_BREAKER_BLOWN", detail: error.message });
        }
    }

    /**
     * Context Cascade Injection
     * Configures execution bounds immediately before running user scripts.
     */
    async _preProcess(entry, packet) {
        const strategyInstance = entry.instance;

        // 1. Hot-swap parameter changes from DB shadow store without strategy restarts
        const latestParams = await configService.getParamsFor(entry.runtimeId);
        if (typeof strategyInstance.updateParams === "function") {
            strategyInstance.updateParams(latestParams);
        }

        // 2. Query broker source-of-truth position records and build a read-only snapshot view
        let posSnapshot = { positions: {}, openCount: 0, totalUnrealized: 0 };
        if (entry.broker && typeof entry.broker.getPositionSnapshot === "function") {
            posSnapshot = entry.broker.getPositionSnapshot(entry.symbol);
        } else if (entry.broker && entry.broker.positions && typeof entry.broker.positions.snapshot === "function") {
            posSnapshot = entry.broker.positions.snapshot();
        }

        // 3. Inject read-only data layout directly into strategy context fields
        if (typeof strategyInstance.setPositionsSnapshot === "function") {
            strategyInstance.setPositionsSnapshot(posSnapshot);
        } else {
            strategyInstance._posSnapshot = posSnapshot;
        }

        // 4. Flush the multi-call proxy indicator cache maps for the duration of this tick loop
        if (strategyInstance._indicatorAdapter && typeof strategyInstance._indicatorAdapter._tickReset === "function") {
            strategyInstance._indicatorAdapter._tickReset();
        }
    }

    /**
     * Executes the strategy user script file calculations cleanly wrapped inside an error catcher.
     */
    _callStrategy(entry, packet, context) {
        const strategyInstance = entry.instance;

        // Warm-up historical guard validation check
        if (typeof strategyInstance.isWarmedUp === "function" && !strategyInstance.isWarmedUp(entry.symbol)) {
            return null; // Suppress signals until historical lookback sizing has completed loading
        }

        // Data manager history buffer ingestion
        if (strategyInstance.dataManager) {
            if (context.source === "bar") {
                strategyInstance.dataManager.ingestBar(packet);
                strategyInstance.currentBar = packet;
            } else if (typeof strategyInstance.dataManager.updateTick === "function") {
                const result = strategyInstance.dataManager.updateTick(packet, strategyInstance.tfMs);
                
                // Candle-based synchronization suppression checkpoint
                if (strategyInstance.candleBased && result && !result.closed) {
                    return null; // Force exit if evaluating bar state updates before an active close
                }
            }
        }

        // Fire entry execute loops on user script
        if (typeof strategyInstance.next === "function") {
            return strategyInstance.next(packet);
        } else if (typeof strategyInstance.onTick === "function") {
            return strategyInstance.onTick();
        }

        return null;
    }

    /**
     * Validates data schemas, binds context fields, and locks the output payload.
     */
    _postProcess(runtimeId, signal, packet, context, entry) {
        // If the strategy loop evaluated a pass action, drop tracking chains
        if (!signal) {
            // Evaluate deferred counter flip tasks if strategy has flagged secondary executions
            if (entry.instance && typeof entry.instance.applyDeferredFlip === "function") {
                signal = entry.instance.applyDeferredFlip();
            }
            if (!signal) return null;
        }

        // 1. Explicitly stamp execution identity frames onto target transaction
        signal.runtimeId = runtimeId;
        signal.strategyId = runtimeId; // Backward compatibility fallback pairing
        signal.seqNum = context.seqNum || 0;

        // 2. Populate missing transaction timelines
        signal.symbol = signal.symbol || entry.symbol;
        signal.time = signal.time || packet.time || Date.now();
        signal.timestamp = signal.time;
        signal.barTime = signal.barTime || entry.instance.currentBar?.time || packet.time;
        signal.tf = signal.tf || entry.instance.timeframe;
        signal.price = signal.price || packet.price || packet.close || 0;

        // 3. Strict schema validation validation checks
        const isValid = (
            signal.intent && ["ENTER", "EXIT"].includes(signal.intent.toUpperCase()) &&
            signal.side && ["long", "short", "flat"].includes(signal.side.toLowerCase()) &&
            signal.symbol.toUpperCase() === entry.symbol.toUpperCase() &&
            Number.isFinite(signal.quantity) && signal.quantity > 0
        );

        if (!isValid) {
            bus.emit(EVENTS.SYSTEM.ERROR, {
                source: "signal_schema_invalid",
                runtimeId,
                signal
            });
            return null;
        }

        // 4. Risk Guardrails: minBalance and maxDrawdownPct enforcement
        const broker = entry.broker;
        if (broker && typeof broker.getEquity === "function") {
            const equity = broker.getEquity();
            const initialCash = broker.initialCash || 0;
            
            const minBalance = Number(entry.instance.params?.minBalance || 0);
            const maxDrawdownPct = Number(entry.instance.params?.maxDrawdownPct || 100);
            const currentDrawdownPct = initialCash > 0 ? ((initialCash - equity) / initialCash) * 100 : 0;

            if (equity < minBalance || currentDrawdownPct >= maxDrawdownPct) {
                this.logGuard("POST_PROCESS_RISK", false, { 
                    equity, minBalance, currentDrawdownPct, maxDrawdownPct 
                });
                return null;
            }
        }

        // 5. Freeze intentional layout structures completely before passing items to async worker queues
        signal.frozen = true;
        return Object.freeze(signal);
    }
}

module.exports = new SignalGenerationEngine();