// engine/core/pipeline/SignalProcessingEngine.js
"use strict";

const logger = require("@utils/logger");
const RuntimeRegistry = require("../runtime/RuntimeRegistry");

const log = logger.createModuleLogger('SIGNAL_PROCESSING', {
    category: 'pipeline',
    ui: true,
    uiLevels: ['info', 'warn', 'error']
});

class SignalProcessingEngine {
    constructor() {
        this.maxDrawdownThresholdPct = 10.0;
        this.maxDailyLossLimit = 2500;
    }

    process(intent, context = {}) {
        const entry = RuntimeRegistry.get(context.strategyId);
        const brokerInstance = entry?.broker;
        if (!intent) return null;
        if (!brokerInstance) return null;

        const runtimeId = entry.runtimeId;

        if (!intent.intent || !intent.side || !intent.symbol) {
            log.error(`[PROCESSING_REJECTION] Runtime ${runtimeId} emitted a structurally malformed intent object.`);
            return null;
        }

        const currentEquity = brokerInstance.getEquity();
        const initialAllocation = brokerInstance.initialCash;
        const currentDrawdownPct = ((initialAllocation - currentEquity) / initialAllocation) * 100;

        if (currentDrawdownPct >= this.maxDrawdownThresholdPct) {
            log.error(`[PROCESSING_RISK_BLOCK] Runtime ${runtimeId} blocked: Strategy crossed max drawdown limit ceiling (${currentDrawdownPct.toFixed(2)}% >= ${this.maxDrawdownThresholdPct}%).`);
            return null;
        }

        const currentPosition = brokerInstance.getPositionSnapshot(intent.symbol);

        if (intent.intent === "EXIT" && currentPosition.side === "FLAT") {
            return null;
        }

        if (intent.intent === "ENTER" && currentPosition.side === intent.side) {
            if (!intent.allowScaling) {
                return null;
            }
        }

        return { accepted: true, signal: intent };
    }
}

module.exports = new SignalProcessingEngine();