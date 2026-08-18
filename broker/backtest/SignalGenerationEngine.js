"use strict";

const RuntimeRegistry = require("../../engine/core/runtime/RuntimeRegistry");
const { bus, EVENTS } = require("@events/bus");

class SignalGenerationEngine {
    /**
     * The Tick Sandwich: Pre-process (inject state) -> Call Strategy -> Post-process (stamp & freeze)
     */
    async process(runtimeId, packet, context) {
        const entry = RuntimeRegistry.get(runtimeId);
        if (!entry || entry.actualState !== "ACTIVE") return null;

        try {
            // 1. Pre-process: Context Cascade
            // Inject latest parameters and fresh position snapshots
            entry.instance.updateParams(entry.params);
            
            const posSnap = entry.broker.getPositionSnapshot(entry.symbol);
            entry.instance.executionContext = {
                broker: entry.broker,
                posSnapshot: posSnap
            };

            // 2. Call Strategy
            if (!entry.instance.isWarmedUp()) return null;
            
            const signal = await entry.instance.generateSignal(packet, context);
            if (!signal) return null;

            // 3. Post-process: Stamp, Validate, Freeze
            signal.runtimeId = runtimeId;
            signal.strategyId = runtimeId; 
            signal.timestamp = Date.now();
            
            if (!this._validate(signal)) {
                bus.emit(EVENTS.SYSTEM.ERROR, { source: "signal_validation", runtimeId });
                return null;
            }

            return Object.freeze(signal);
        } catch (err) {
            bus.emit(EVENTS.SYSTEM.ERROR, { source: "strategy_runtime", runtimeId, error: err.message });
            return null;
        }
    }

    _validate(s) {
        return s.intent && s.side && s.symbol && s.quantity > 0;
    }
}

module.exports = new SignalGenerationEngine();