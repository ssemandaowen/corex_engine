"use strict";

/**
 * corex-market-data — Index
 *
 * Central export for the CoreX Market Data Layer.
 * Re-exports all providers, contract, factory, and the MarketFeed singleton.
 *
 * On load, auto-registers the default TwelveDataProvider (wrapping the
 * legacy @broker/twelvedata singleton) as the active provider so that
 * integration points calling DataProviderFactory.fetchHistorical() work
 * without explicit setup.
 */

const DataProviderFactory = require("./src/DataProviderFactory");
const { DataProviderContract, validateProviderImplementation, DataProviderError, DATA_PROVIDER_CONTRACT_VERSION } = require("./src/DataProviderContract");
const { TwelveDataProvider } = require("./src/providers/TwelveDataProvider");
const { FileDataProvider } = require("./src/providers/FileDataProvider");
const { YahooFinanceProvider } = require("./src/providers/YahooFinanceProvider");
const { fetchGuardedHistory, MAX_BARS_LIMIT } = require("./src/backtestDataResolver");

// Auto-register default provider
try {
    const defaultProvider = new TwelveDataProvider();
    DataProviderFactory.register("twelvedata", defaultProvider);
    DataProviderFactory.setActive("twelvedata");
} catch (err) {
    // Provider registration may fail in test environments without broker deps.
    // Tests can register mock providers as needed.
}

module.exports = {
    DataProviderFactory,
    DataProviderContract,
    validateProviderImplementation,
    DataProviderError,
    DATA_PROVIDER_CONTRACT_VERSION,
    TwelveDataProvider,
    FileDataProvider,
    YahooFinanceProvider,
    fetchGuardedHistory,
    MAX_BARS_LIMIT
};
