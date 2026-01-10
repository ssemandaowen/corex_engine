"use strict";

const router = require("express").Router();
const loader = require("../strategyLoader");
const logger = require("../../utils/logger");

/**
 * @route   GET /api/strategies
 * @desc    Lists all strategies with high-level status, current parameters, and metadata.
 * @access  Private (Admin)
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
        schema: entry.instance.schema, // The "Inputs" for UI generation
        currentParams: entry.instance.params,
        metadata: {
            symbols: entry.instance.symbols,
            timeframe: entry.instance.timeframe,
            lookback: entry.instance.lookback
        }
    });
});

const { validateStrategyCode } = require("../../utils/security");
const fs = require("fs");
const path = require("path");

/**
 * @route   POST /api/strategies/create
 * @desc    Uploads a new strategy file after passing security validation.
 */
router.post("/create", (req, res) => {
    const { name, code } = req.body;

    if (!name || !code) return res.status(400).json({ error: "Missing name or code" });

    // 1. Security Guard: Prevent RCE (Remote Code Execution)
    if (!validateStrategyCode(code)) {
        return res.status(403).json({ error: "Security Violation: Illegal code patterns detected." });
    }

    const filename = `${name.replace(/\s+/g, '_').toLowerCase()}.js`;
    const fullPath = path.join(loader.strategiesPath, filename);

    try {
        fs.writeFileSync(fullPath, code);
        // The FS Watcher in loader.js will automatically pick this up and stage it
        res.json({ success: true, message: `Strategy ${name} created and staged.` });
    } catch (err) {
        res.status(500).json({ error: "Disk Write Failed" });
    }
});


/**
 * @route   POST /api/strategies/:id/:action
 * @desc    Manages Lifecycle: START | STOP | RELOAD
 */
router.post("/:id/:action", (req, res) => {
    const { id, action } = req.params;
    
    try {
        let result;
        switch (action.toLowerCase()) {
            case 'start':
                result = loader.startStrategy(id);
                break;
            case 'stop':
                result = loader.stopStrategy(id);
                break;
            case 'reload':
                // Hot-reloading logic integrated in loadStrategy
                const filePath = loader.registry.get(id)?.filePath;
                if (!filePath) throw new Error("File path lost.");
                loader.loadStrategy(filePath);
                result = loader.registry.get(id);
                break;
            default:
                return res.status(400).json({ success: false, error: "INVALID_ACTION" });
        }

        res.json({
            success: true,
            action,
            id,
            status: result.status,
            active: result.instance.enabled
        });
    } catch (err) {
        logger.error(`[API] Action ${action} failed for ${id}: ${err.message}`);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * @route   PATCH /api/strategies/:id/settings
 * @desc    Updates strategy parameters (RSI, Risk, etc.) via the UI settings panel.
 */
router.patch("/:id/settings", (req, res) => {
    const { id } = req.params;
    const entry = loader.registry.get(id);

    if (!entry) return res.status(404).json({ success: false, error: "STRATEGY_NOT_FOUND" });

    try {
        // updateParams handles validation via BaseStrategy
        entry.instance.updateParams(req.body);

        res.json({
            success: true,
            message: "Parameters updated successfully",
            id: entry.id,
            currentParams: entry.instance.params
        });
    } catch (err) {
        logger.error(`[API] Settings update failed for ${id}: ${err.message}`);
        res.status(400).json({ success: false, error: "VALIDATION_FAILED", details: err.message });
    }
});

module.exports = router;