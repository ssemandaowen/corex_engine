// engine/signalAdapter.js
"use strict";

const runtimeRegistry = require("./core/runtime/RuntimeRegistry");
const marketFeed = require("./core/runtime/MarketFeed");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("SIGNAL_ADAPTER");

/**
 * CoreX Signal Adapter
 * Simplified inbound multiplexer dedicated to pure OHLCV candlestick bars.
 * Standardizes API payloads from Twelve Data / MetaAPI and safely queues them.
 */
class SignalAdapter {
    /**
     * Entry-point interface for incoming OHLCV candle updates from MetaAPI or Twelve Data.
     * @param {Object} rawBar - Raw candlestick bar payload containing Open, High, Low, Close, Volume
     */
    routeIncomingTick(rawBar) {
        if (!rawBar || !rawBar.symbol) return;

        const canonicalSymbol = rawBar.symbol.toUpperCase();

        // 1. Instantly match against our in-memory cache of active strategies
        const activeRuntimes = runtimeRegistry.forSymbol(canonicalSymbol);
        if (activeRuntimes.length === 0) return;

        // 2. Wrap incoming metrics into a clean, dedicated OHLCV packet contract
        const packet = {
            symbol: canonicalSymbol,
            open: Number(rawBar.open || rawBar.close || 0),
            high: Number(rawBar.high || rawBar.close || 0),
            low: Number(rawBar.low || rawBar.close || 0),
            close: Number(rawBar.close || 0),
            volume: Number(rawBar.volume || 0),
            time: rawBar.time ? new Date(rawBar.time).getTime() : Date.now()
        };

        // 3. Hand off to MarketFeed for each active runtime trading this symbol
        for (let i = 0; i < activeRuntimes.length; i++) {
            const runtimeEntry = activeRuntimes[i];
            marketFeed.feedBar(runtimeEntry.runtimeId, packet).catch((e) => {
                log.error(`[BAR:${runtimeEntry.runtimeId}] feedBar failed: ${e.message}`);
            });
        }
    }
}

module.exports = new SignalAdapter();