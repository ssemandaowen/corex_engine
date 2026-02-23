"use strict";

const express = require('express');
const router = express.Router();
const loader = require('@core/strategyLoader'); // Import the Loader directly
const stateManager = require('@utils/stateController');
const logger = require('@utils/logger');
const { MODES, TIME, BRIDGE_INTEGRATIONS } = require("@config/constants");
const pgStore = require("@core/services/pgStore");

/**
 * EXECUTION DOMAIN
 * Handles Tab 3: Run (Live/Paper/Backtest)
 */

// 1. GET ENGINE STATUS
router.get('/status', (req, res) => {
    // We use the loader's list method because it aggregates 
    // status + instance params + uptime into one payload.
    const strategies = loader.listStrategies();
    
    // Convert array to Key-Value object for the Frontend Object.entries mapping
    const payload = {};
    strategies.forEach(s => { payload[s.id] = s; });

    res.json({ success: true, payload });
});

router.get('/telemetry/:id', (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);
    if (!entry || !entry.instance) {
        return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });
    }

    const barsRaw = Number(req.query?.bars ?? 600);
    const bars = Math.max(10, Math.min(5000, Number.isFinite(barsRaw) ? barsRaw : 600));
    const requestedSymbol = String(req.query?.symbol || entry.instance.symbols?.[0] || "");
    const dm = entry.instance.dataManager;
    const dataSymbols = dm?.data && typeof dm.data.keys === "function" ? Array.from(dm.data.keys()) : [];
    const symbol = (requestedSymbol && dm?.data?.get?.(requestedSymbol))
        ? requestedSymbol
        : (dataSymbols[0] || requestedSymbol);
    const store = symbol && dm?.data?.get?.(symbol) ? dm.data.get(symbol) : null;
    const historical = symbol ? (entry.instance.getLookbackWindow?.(symbol) || []) : [];
    const trimmed = Array.isArray(historical) ? historical.slice(-bars) : [];
    const active = store?.activeCandle ? [{ ...store.activeCandle, symbol }] : [];
    const candles = [...trimmed, ...active]
        .filter((c) => c && Number.isFinite(Number(c.time)))
        .map((c) => ({
            symbol,
            time: Number(c.time),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 0)
        }))
        .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
        .sort((a, b) => a.time - b.time)
        .slice(-bars);

    const status = stateManager.getStatus(id);
    const summary = loader.listStrategies().find((s) => s.id === id) || null;
    return res.json({
        success: true,
        payload: {
            id,
            status,
            symbol,
            symbols: entry.instance.symbols || [],
            dataSymbols,
            mode: entry.instance.mode || null,
            timeframe: entry.instance.timeframe || null,
            lookback: entry.instance.lookback || null,
            maxDataHistory: entry.instance.max_data_history || null,
            params: entry.instance.params || {},
            schema: entry.instance.schema || {},
            api: Array.isArray(entry.instance.__corexApi) ? entry.instance.__corexApi : [],
            dataPoints: summary?.dataPoints ?? 0,
            historyPoints: summary?.historyPoints ?? 0,
            lookbackCoveragePct: summary?.lookbackCoveragePct ?? 0,
            candles,
            activeCandle: store?.activeCandle || null,
            lastTick: entry.instance.lastTick || null
        }
    });
});

// 2. DEPLOY STRATEGY (OFFLINE -> ACTIVE)
router.post('/start/:id', (req, res) => {
    const { id } = req.params;
    const { mode, params, timeframe } = req.body;

    if (id === 'undefined' || !id) {
        return res.status(400).json({ success: false, error: "Strategy ID is required" });
    }

    // 1. Call the loader method directly to trigger the Engine handover
    const normalizedMode = String(mode || MODES.PAPER).toUpperCase();
    if (![MODES.PAPER, MODES.LIVE].includes(normalizedMode)) {
        return res.status(400).json({ success: false, error: `INVALID_MODE: ${normalizedMode}` });
    }
    const normalizedTf = String(timeframe || TIME.DEFAULT_TIMEFRAMES[0]);

    const entry = loader.startStrategy(id, {
        mode: normalizedMode,
        timeframe: normalizedTf,
        strategyParams: params || {} 
    });

    if (!entry) {
        return res.status(404).json({ success: false, error: `Strategy [${id}] not found in registry.` });
    }

    logger.info(`Execution request processed for [${id}] in mode: ${normalizedMode}`, {
        timeframe: normalizedTf
    });

    res.json({ 
        success: true, 
        message: `Deployment initiated for ${id}. Engine handover in progress...` 
    });
});

// 3. TERMINATE STRATEGY (ACTIVE -> OFFLINE)
router.post('/stop/:id', (req, res) => {
    const { id } = req.params;

    const entry = loader.stopStrategy(id);

    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    res.json({ 
        success: true, 
        message: `Stop signal processed for ${id}. Connections closing.` 
    });
});

// 4. REAL-TIME PARAM TUNING
router.patch('/params/:id', (req, res) => {
    const { id } = req.params;
    const { params } = req.body;

    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    // If active, hot-swap and persist. If inactive, just persist (applies next start).
    const status = stateManager.getStatus(id);
    if (entry.instance.updateParams) {
        entry.instance.updateParams(params);
    }
    loader._saveParams(id, params);
    loader._updateRuntimeStateInDb(id, { params }).catch(() => {});

    if (status === 'ACTIVE') {
        return res.json({ success: true, message: "Parameters hot-swapped and persisted." });
    }
    return res.json({ success: true, message: "Parameters saved. They will apply on next start." });
});

router.get("/config", async (req, res) => {
    try {
        const persisted = await pgStore.getSystemSettings();
        const payload = persisted?.payload || {};
        const run = payload.run && typeof payload.run === "object" ? payload.run : {};
        const providers = Array.isArray(run.bridgeProviders) && run.bridgeProviders.length > 0
            ? run.bridgeProviders
            : [BRIDGE_INTEGRATIONS.PYTHON_RECEIVER, BRIDGE_INTEGRATIONS.MQL5_RECEIVER, BRIDGE_INTEGRATIONS.METAAPI];

        const defaultMode = String(run.defaultMode || MODES.PAPER).toUpperCase();
        const allowedModes = Array.isArray(run.allowedModes) && run.allowedModes.length > 0
            ? run.allowedModes.map((m) => String(m).toUpperCase())
            : [MODES.PAPER, MODES.LIVE];

        const timeframes = Array.isArray(run.timeframes) && run.timeframes.length > 0
            ? run.timeframes
            : TIME.DEFAULT_TIMEFRAMES;

        res.json({
            success: true,
            payload: {
                modes: allowedModes,
                defaultMode: allowedModes.includes(defaultMode) ? defaultMode : allowedModes[0],
                timeframes,
                defaultTimeframe: run.defaultTimeframe || timeframes[0],
                bridgeProviders: providers,
                activeBridgeProvider: String(run.activeBridgeProvider || providers[0] || BRIDGE_INTEGRATIONS.PYTHON_RECEIVER)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "RUN_CONFIG_READ_FAILED", message: err.message });
    }
});

// 5. RESTORE DEFAULT PARAMS
router.post('/params/:id/reset', (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    let defaults = null;
    try {
        const fresh = loader._instantiateStrategy(entry.source || "", entry.id);
        if (fresh && typeof fresh._applyDefaults === 'function') fresh._applyDefaults();
        defaults = fresh?.params || {};
    } catch (e) {
        defaults = null;
    }

    if (!defaults || Object.keys(defaults).length === 0) {
        if (entry.instance._applyDefaults) {
            entry.instance._applyDefaults();
        }
        defaults = entry.instance.params || {};
    }

    if (entry.instance.updateParams) {
        entry.instance.updateParams(defaults);
    } else {
        entry.instance.params = { ...(defaults || {}) };
    }

    loader._saveParams(id, entry.instance.params || {});

    logger.info(`Default parameters restored for strategy [${id}].`);
    return res.json({ success: true, payload: entry.instance.params || {}, message: "Defaults restored and persisted." });
});

module.exports = router;
