"use strict";

class SignalGenerationEngine {
    generate({ strategy, packet, context = {} } = {}) {
        if (!strategy || typeof strategy !== "object") return null;

        if (typeof strategy.generateSignal === "function") {
            return strategy.generateSignal(packet, context);
        }
        if (typeof strategy.onMarketData === "function") {
            return strategy.onMarketData(packet, context);
        }
        if (typeof strategy.onTick === "function") {
            return strategy.onTick(packet, !!context.isWarmup);
        }
        if (typeof strategy.onBar === "function") {
            return strategy.onBar(packet);
        }
        if (typeof strategy.next === "function") {
            return strategy.next(packet);
        }
        return null;
    }
}

module.exports = SignalGenerationEngine;

