"use strict";

const path = require("path");
const logger = require("@utils/logger");
const storage = require("@utils/storageManager");

const CACHE_DIR = path.resolve(process.env.COREX_CACHE_PATH || "./cache/historical");

// Helper to get the cache file path
const getCachePath = (symbol, timeframe) => 
    path.join(CACHE_DIR, `${symbol.replace("/", "_")}-${timeframe}.csv`);

class HistoricalCache {
    constructor() {
        storage.ensureDir(CACHE_DIR);
    }

    /**
     * Saves historical bar data to the cache as a CSV file.
     * @param {string} symbol - The trading symbol (e.g., 'EUR/USD').
     * @param {string} timeframe - The timeframe (e.g., '1h').
     * @param {Array<object>} data - Array of bar objects.
     */
    async save(symbol, timeframe, data) {
        if (!data || data.length === 0) {
            return;
        }
        const filePath = getCachePath(symbol, timeframe);
        logger.info(`[CACHE] Saving ${data.length} bars to ${filePath}`);
        try {
            // Use storageManager to write the CSV.
            // The `writeCsvOrGz` function handles DataFrame creation and writing.
            await storage.writeCsvOrGz(filePath, data, { compress: false });
        } catch (err) {
            logger.error(`[CACHE] Failed to save CSV cache for ${symbol}-${timeframe}: ${err.message}`);
        }
    }

    /**
     * Retrieves historical bar data from the cache.
     * @param {string} symbol - The trading symbol.
     * @param {string} timeframe - The timeframe.
     * @returns {Promise<Array<object>|null>} Array of bar objects or null if not found.
     */
    async get(symbol, timeframe) {
        const filePath = getCachePath(symbol, timeframe);
        try {
            // Use storageManager to read the CSV.
            // `readCsvOrGz` will try both .csv and .csv.gz
            const data = await storage.readCsvOrGz(filePath);
            
            if (data && data.length > 0) {
                logger.info(`[CACHE] Loaded ${data.length} bars from ${filePath}`);
                // data-forge's `dynamicTyping` is good, but let's ensure types are correct for OHLCV data.
                return data.map(row => ({
                    time: Number(row.time),
                    open: Number(row.open),
                    high: Number(row.high),
                    low: Number(row.low),
                    close: Number(row.close),
                    volume: Number(row.volume || 0) // handle case where volume might be missing
                }));
            }
            return null;
        } catch (err) {
            logger.warn(`[CACHE] Miss for ${symbol}-${timeframe}: ${err.message}`);
            return null;
        }
    }
}

module.exports = new HistoricalCache();