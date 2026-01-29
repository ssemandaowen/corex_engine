"use strict";

const router = require("express").Router();
const loader = require("@core/strategyLoader");
const logger = require("@utils/logger");
const { validateStrategyCode } = require("@utils/security");
const fs = require("fs");
const path = require("path");

/**
 * @route   GET /api/strategies
 * @desc    Lists all strategies with high-level status, current parameters, and metadata.
 * @access  Private (Admin)
 * @returns {Object} {
 *   success: boolean,
 *   count: number,
 *   data: Array<{
 *     id: string,
 *     name: string,
 *     status: 'IDLE'|'RUNNING'|'STOPPED',
 *     symbols: string[],
 *     uptime: number,
 *     params: Object,
 *     schema: Object
 *   }>,
 *   timestamp: number
 * }
 */
router.get("/", (req, res) => {
    try {
        const list = loader.listStrategies();
        res.json({
            success: true,
            count: list.length,
            data: list,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error(`[API] listStrategies failed: ${err.message}`);
        res.status(500).json({ success: false, error: "FETCH_FAILED" });
    }
});

/**
 * @route   GET /api/strategies/:id/manifest
 * @desc    Returns the dynamic schema (inputs) and current values for the UI settings panel.
 * @access  Private (Admin)
 * @param   {string} id - Strategy identifier
 * @returns {Object} {
 *   success: boolean,
 *   id: string,
 *   name: string,
 *   status: string,
 *   schema: Object,          // Strategy parameter schema (from strategy.schema)
 *   currentParams: Object,   // Current parameter values
 *   metadata: {
 *     symbols: string[],
 *     timeframe: string,
 *     lookback: number
 *   }
 * }
 */
router.get("/:id/manifest", (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);

    if (!entry) {
        return res.status(404).json({ success: false, error: `Strategy ${id} not found.` });
    }

    res.json({
        success: true,
        id: entry.id,
        name: entry.instance.name,
        status: entry.status,
        schema: entry.instance.schema,
        currentParams: entry.instance.params,
        metadata: {
            symbols: entry.instance.symbols,
            timeframe: entry.instance.timeframe,
            lookback: entry.instance.lookback
        }
    });
});

/**
 * @route   POST /api/strategies/create
 * @desc    Uploads a new strategy file after passing security validation.
 * @body    { name: string, code: string }
 * @returns {Object} {
 *   success: boolean,
 *   message: string
 * }
 */
router.post("/create", (req, res) => {
    const { name, code } = req.body;

    if (!name || !code) return res.status(400).json({ error: "Missing name or strategy code logic" });

    if (!validateStrategyCode(code)) {
        return res.status(403).json({ error: "Security Violation: Illegal code patterns detected." });
    }

    const filename = `${name.replace(/\s+/g, '_').toLowerCase()}.js`;
    const fullPath = path.join(loader.strategiesPath, filename);

    try {
        fs.writeFileSync(fullPath, code);
        logger.info(`Strategy ${name} created and staged.`);
        res.json({ success: true, message: `Strategy ${name} created and staged.` });
    } catch (err) {
        logger.error(`Strategy creation failed: ${err.message}`);
        res.status(500).json({ error: "Strategy creation Failed" });
    }
});

/**
 * @route   POST /api/strategies/:id/start
 * @desc    Start a strategy in specified execution mode
 * @param   {string} id - Strategy identifier
 * @body    { 
 *            mode: 'PAPER'|'BACKTEST',  // Default: 'PAPER'
 *            [strategyParams]: Object    // Optional strategy parameters
 *          }
 * @returns {Object} {
 *   success: boolean,
 *   action: 'start',
 *   id: string,
 *   status: string,
 *   active: boolean,
 *   mode: 'PAPER'|'BACKTEST'
 * }
 */
router.post("/:id/start", (req, res) => {
    const { id } = req.params;
    const { mode = 'PAPER', strategyParams = {} } = req.body || {};
    
    // Validate mode
    if (!['PAPER', 'BACKTEST'].includes(mode)) {
        return res.status(400).json({ 
            success: false, 
            error: "Invalid mode. Use 'PAPER' or 'BACKTEST'" 
        });
    }

    try {
        const result = loader.startStrategy(id, { mode, strategyParams });
        
        if (!result) {
            return res.status(404).json({ success: false, error: "Strategy not found" });
        }

        res.json({
            success: true,
            action: 'start',
            id: result.id,
            status: result.status,
            active: result.instance.enabled,
            mode: result.instance.mode
        });
    } catch (err) {
        logger.error(`[API] Start failed for ${id}: ${err.message}`);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/strategies/:id/stop
 * @desc    Stop a running strategy
 * @param   {string} id - Strategy identifier
 * @returns {Object} {
 *   success: boolean,
 *   action: 'stop',
 *   id: string,
 *   status: string
 * }
 */
router.post("/:id/stop", (req, res) => {
    const { id } = req.params;
    
    try {
        const result = loader.stopStrategy(id);
        
        if (!result) {
            return res.status(404).json({ 
                success: false, 
                error: "Strategy not found or not running" 
            });
        }

        res.json({
            success: true,
            action: 'stop',
            id: result.id,
            status: result.status
        });
    } catch (err) {
        logger.error(`[API] Stop failed for ${id}: ${err.message}`);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/strategies/:id/reload
 * @desc    Reload strategy code (hot reload)
 * @param   {string} id - Strategy identifier
 * @returns {Object} {
 *   success: boolean,
 *   action: 'reload',
 *   id: string,
 *   status: string
 * }
 */
router.post("/:id/reload", (req, res) => {
    const { id } = req.params;
    
    try {
        const filePath = loader.registry.get(id)?.filePath;
        if (!filePath) throw new Error("File path lost.");
        
        loader.loadStrategy(filePath);
        const result = loader.registry.get(id);
        
        if (!result) {
            return res.status(404).json({ success: false, error: "Strategy not found after reload" });
        }

        res.json({
            success: true,
            action: 'reload',
            id: result.id,
            status: result.status
        });
    } catch (err) {
        logger.error(`[API] Reload failed for ${id}: ${err.message}`);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * @route   PATCH /api/strategies/:id/settings
 * @desc    Update strategy parameters (defined in strategy.schema)
 * @param   {string} id - Strategy identifier
 * @body    { 
 *            // Parameters defined in strategy.schema
 *            // Example: { stopLoss: 1.5, takeProfit: 3.0, rsiPeriod: 14 }
 *          }
 * @returns {Object} {
 *   success: boolean,
 *   message: string,
 *   id: string,
 *   currentParams: Object
 * }
 */
router.patch("/:id/settings", (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);

    if (!entry) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });

    try {
        entry.instance.updateParams(req.body);
        res.json({
            success: true,
            message: "Parameters updated successfully",
            id: entry.id,
            currentParams: entry.instance.params
        });
    } catch (err) {
        logger.error(`[API] Settings update failed for ${id}: ${err.message}`);
        res.status(400).json({ success: false, error: "VALIDATION_FAILED" });
    }
});

module.exports = router;