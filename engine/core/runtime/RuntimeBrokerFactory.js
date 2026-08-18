// engine/core/runtime/RuntimeBrokerFactory.js
"use strict";

const { MODES, PAPER_BROKER_DEFAULTS, DEFAULT_STRATEGY_CONFIG } = require("../../../config/constants");
const BacktestBroker = require("../../../broker/modes/BacktestBroker");
const PaperBroker = require("../../../broker/modes/PaperBroker");
const LiveBroker = require("../../../broker/modes/LiveBroker");

/**
 * CoreX Runtime Broker Factory
 * Instantiates and configures dedicated polymorphic execution environments per sandbox instance.
 */
class RuntimeBrokerFactory {
    /**
     * Resolves and builds a structural child broker subclass.
     * @param {string} mode - BACKTEST | PAPER | LIVE
     * @param {Object} opts - Custom override parameters (e.g. initialCash, userId)
     * @param {string} opts.runtimeId - Scoped execution tracking footprint ID
     * @param {string} opts.symbol - Active market asset string identifier
     * @returns {BaseBroker} Active Polymorphic Broker Instance
     */
    createBroker(mode, opts = {}) {
        if (!opts.runtimeId) {
            throw new Error("[BrokerFactory] Allocation aborted: runtimeId parameter is strictly required.");
        }

        const normalizedMode = String(mode).toUpperCase();
        const assetSymbol = String(opts.symbol || "").toUpperCase();

        switch (normalizedMode) {
        case MODES.BACKTEST:
            // Instantiates a clean, synchronous backtest tracking matrix
            return new BacktestBroker({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                initialCash: Number(opts.initialCash || DEFAULT_STRATEGY_CONFIG.INITIAL_CASH)
            });

        case MODES.PAPER:
            // Instantiates a per-user or isolated paper simulation layer.
            // brokerConfig carries commissionPct/slippageBps/spreadBps/leverage/
            // marginCall/stopOut/executionLatency/fillPolicy/baseCurrency — read
            // live by PaperBroker's getters, so persisted settings (fetched by the
            // caller from user_broker_settings) take effect immediately.
            return new PaperBroker({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                userId: opts.userId || "system_fallback",
                initialCash: Number(opts.initialCash || PAPER_BROKER_DEFAULTS.INITIAL_CASH),
                brokerConfig: {
                    slippageBps: PAPER_BROKER_DEFAULTS.SLIPPAGE_BPS,
                    spreadBps: PAPER_BROKER_DEFAULTS.SPREAD_BPS,
                    leverage: PAPER_BROKER_DEFAULTS.LEVERAGE,
                    ...(opts.brokerConfig || {})
                }
            });

        case MODES.LIVE:
            // Instantiates a direct live terminal gateway interface
            return new LiveBroker({
                runtimeId: opts.runtimeId,
                symbol: assetSymbol,
                userId: opts.userId,
                connectorType: opts.connectorType || "metaapi", // Default connector strategy selection
                brokerConfig: { ...(opts.brokerConfig || {}) }
            });

        default:
            throw new Error(`[BrokerFactory] Production failure: execution mode '${mode}' maps to no valid broker module subclass.`);
        }
    }
}

module.exports = new RuntimeBrokerFactory();