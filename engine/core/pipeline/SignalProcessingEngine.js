"use strict";

const { normalizeSignal, isSignalValid } = require("./SignalPipelineUtils");

class SignalProcessingEngine {
    process(rawSignal, context = {}) {
        const normalized = normalizeSignal(rawSignal, context);
        if (!isSignalValid(normalized)) {
            return { accepted: false, reason: "INVALID_SIGNAL", signal: null };
        }
        return { accepted: true, reason: null, signal: normalized };
    }
}

module.exports = SignalProcessingEngine;

