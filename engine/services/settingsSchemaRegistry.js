"use strict";

const { RISK_DEFAULTS, DEFAULT_STRATEGY_CONFIG, PAPER_BROKER_DEFAULTS } = require("@config/constants");

/**
 * Settings Schema Registry
 */

const SCHEMA = {
    // Engine / Execution settings
    max_concurrent_strategies: {
        key: "max_concurrent_strategies",
        type: "int",
        label: "Max Concurrent Strategies",
        group: "Execution",
        default: 3,
        min: 1,
        max: 20,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_engine_settings", column: "max_concurrent_strategies" }
    },
    default_paper_balance: {
        key: "default_paper_balance",
        type: "float",
        label: "Default Paper Balance",
        group: "Execution",
        default: 100000,
        min: 100,
        max: 10000000,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_engine_settings", column: "default_paper_balance" }
    },
    default_timeframe: {
        key: "default_timeframe",
        type: "enum",
        label: "Default Timeframe",
        group: "Execution",
        default: "1m",
        enum: ["1s", "5s", "15s", "1m", "5m", "15m", "1h", "4h", "1d"],
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_engine_settings", column: "default_timeframe" }
    },
    default_mode: {
        key: "default_mode",
        type: "enum",
        label: "Default Execution Mode",
        group: "Execution",
        default: "PAPER",
        enum: ["PAPER", "LIVE"],
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_engine_settings", column: "default_mode" }
    },

    // Unenforced risk settings (D5)
    risk_max_daily_loss_pct: {
        key: "risk_max_daily_loss_pct",
        type: "float",
        label: "Max Daily Loss %",
        group: "Risk Guardrails",
        default: null,
        min: 0.1,
        max: 100.0,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: false,
        enforced: false,
        storage: { table: "user_engine_settings", column: "risk_max_daily_loss_pct" }
    },
    risk_max_position_pct: {
        key: "risk_max_position_pct",
        type: "float",
        label: "Max Position %",
        group: "Risk Guardrails",
        default: null,
        min: 0.1,
        max: RISK_DEFAULTS.MAX_POSITION_SIZE * 100, // 25%
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: false,
        enforced: false,
        storage: { table: "user_engine_settings", column: "risk_max_position_pct" }
    },

    // Broker / Account Settings (F2: require mode parameter)
    initialCash: {
        key: "initialCash",
        type: "float",
        label: "Initial Capital",
        group: "Account Simulation",
        default: 100000,
        min: 100,
        max: 10000000,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_broker_settings", column: "initial_cash" }
    },
    riskFloor: {
        key: "riskFloor",
        type: "float",
        label: "Risk Drawdown Floor",
        group: "Risk Guardrails",
        default: null,
        min: 0.0,
        max: RISK_DEFAULTS.MAX_GLOBAL_DRAWDOWN_PCT / 100, // 0.10 (10%)
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_broker_settings", path: "config.riskFloor" }
    },
    commissionPct: {
        key: "commissionPct",
        type: "float",
        label: "Commission Rate %",
        group: "Account Simulation",
        default: 0,
        min: 0,
        max: 5,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_broker_settings", path: "config.commissionPct" }
    },
    slippageBps: {
        key: "slippageBps",
        type: "float",
        label: "Slippage (basis points)",
        group: "Account Simulation",
        default: PAPER_BROKER_DEFAULTS.SLIPPAGE_BPS || 5,
        min: 0,
        max: 500,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_broker_settings", path: "config.slippageBps" }
    },
    spreadBps: {
        key: "spreadBps",
        type: "float",
        label: "Spread (basis points)",
        group: "Account Simulation",
        default: PAPER_BROKER_DEFAULTS.SPREAD_BPS || 2,
        min: 0,
        max: 500,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_broker_settings", path: "config.spreadBps" }
    },
    leverage: {
        key: "leverage",
        type: "float",
        label: "Account Leverage",
        group: "Account Simulation",
        default: 1,
        min: 1,
        max: 500,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_broker_settings", path: "config.leverage" }
    },

    // UI / Editor / Display settings (D2: user_system_settings.payload->'ui')
    theme: {
        key: "theme",
        type: "enum",
        label: "UI Theme",
        group: "Appearance",
        default: "dark",
        enum: ["dark", "light", "godot-dark", "godot-light", "high-contrast"],
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.theme" }
    },
    editorFontSize: {
        key: "editorFontSize",
        type: "int",
        label: "Code Editor Font Size",
        group: "Code Editor",
        default: 13,
        min: 8,
        max: 32,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorFontSize" }
    },
    editorTabSize: {
        key: "editorTabSize",
        type: "int",
        label: "Code Editor Tab Size",
        group: "Code Editor",
        default: 2,
        min: 1,
        max: 8,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorTabSize" }
    },
    editorWordWrap: {
        key: "editorWordWrap",
        type: "bool",
        label: "Code Editor Word Wrap",
        group: "Code Editor",
        default: true,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorWordWrap" }
    },
    editorMinimap: {
        key: "editorMinimap",
        type: "bool",
        label: "Code Editor Minimap",
        group: "Code Editor",
        default: false,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorMinimap" }
    },
    editorTheme: {
        key: "editorTheme",
        type: "enum",
        label: "Code Editor Theme",
        group: "Code Editor",
        default: "corex-dark",
        enum: ["corex-dark", "vs-light", "godot-dark-editor", "godot-light-editor", "vs-dark"],
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorTheme" }
    },
    editorLineNumbers: {
        key: "editorLineNumbers",
        type: "bool",
        label: "Code Editor Line Numbers",
        group: "Code Editor",
        default: true,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorLineNumbers" }
    },
    editorAutoClosingBrackets: {
        key: "editorAutoClosingBrackets",
        type: "bool",
        label: "Code Editor Auto Closing Brackets",
        group: "Code Editor",
        default: true,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.editorAutoClosingBrackets" }
    },
    candleViewportSize: {
        key: "candleViewportSize",
        type: "int",
        label: "Chart Viewport Candles",
        group: "Display Limits",
        default: 200,
        min: 20,
        max: 2000,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.candleViewportSize" }
    },
    tablePageSize: {
        key: "tablePageSize",
        type: "int",
        label: "Data Table Page Size",
        group: "Display Limits",
        default: 25,
        min: 5,
        max: 500,
        scope: "user",
        readOnly: false,
        restartRequired: false,
        exposeToFrontend: true,
        enforced: true,
        storage: { table: "user_system_settings", path: "payload.ui.tablePageSize" }
    },

    // Global Server Values (F6: reads real broadcaster/config constants, no system_settings claim)
    wsUpdateRateCap: {
        key: "wsUpdateRateCap",
        type: "int",
        label: "WebSocket Update Rate Cap (ms)",
        group: "System Performance",
        default: PAPER_BROKER_DEFAULTS.POSITION_BROADCAST_MIN_MS || 250,
        min: 50,
        max: 5000,
        scope: "global",
        readOnly: true,
        restartRequired: true,
        exposeToFrontend: true,
        enforced: true
    },
    maxCandleHistory: {
        key: "maxCandleHistory",
        type: "int",
        label: "Max Engine Candle History Cap",
        group: "System Performance",
        default: DEFAULT_STRATEGY_CONFIG.MAX_DATA_HISTORY || 5000,
        min: 100,
        max: 100000,
        scope: "global",
        readOnly: true,
        restartRequired: true,
        exposeToFrontend: false,
        enforced: true
    }
};

/**
 * Validates a key and proposed value against the schema registry.
 * F2: Broker settings require mode.
 */
function validate(key, value, mode = null) {
    const entry = SCHEMA[key];
    if (!entry) {
        return { ok: false, error: "UNKNOWN_SETTING_KEY" };
    }

    if (entry.readOnly || entry.scope === "global") {
        return { ok: false, error: "READ_ONLY_SETTING", bounds: { readOnly: true, scope: entry.scope } };
    }

    if (entry.storage?.table === "user_broker_settings") {
        const cleanMode = String(mode || "").toLowerCase();
        if (!cleanMode || !["paper", "live"].includes(cleanMode)) {
            return { ok: false, error: "MODE_REQUIRED" };
        }
    }

    if (value === null || value === undefined) {
        if (entry.default === null) {
            return { ok: true, value: null };
        }
        return { ok: false, error: "INVALID_VALUE_TYPE", bounds: { expectedType: entry.type } };
    }

    let parsedVal = value;

    switch (entry.type) {
        case "bool": {
            if (typeof value !== "boolean") {
                if (value === "true" || value === "1" || value === 1) parsedVal = true;
                else if (value === "false" || value === "0" || value === 0) parsedVal = false;
                else return { ok: false, error: "INVALID_BOOLEAN_VALUE", bounds: { expectedType: "bool" } };
            }
            break;
        }
        case "int": {
            const num = Number(value);
            if (!Number.isInteger(num)) {
                return { ok: false, error: "INVALID_INTEGER_VALUE", bounds: { expectedType: "int", min: entry.min, max: entry.max } };
            }
            parsedVal = num;
            if (entry.min !== undefined && parsedVal < entry.min) {
                return { ok: false, error: "VALUE_BELOW_MINIMUM", bounds: { min: entry.min, max: entry.max } };
            }
            if (entry.max !== undefined && parsedVal > entry.max) {
                return { ok: false, error: "VALUE_EXCEEDS_MAXIMUM", bounds: { min: entry.min, max: entry.max } };
            }
            break;
        }
        case "float": {
            const num = Number(value);
            if (!Number.isFinite(num)) {
                return { ok: false, error: "INVALID_FLOAT_VALUE", bounds: { expectedType: "float", min: entry.min, max: entry.max } };
            }
            parsedVal = num;
            if (entry.min !== undefined && parsedVal < entry.min) {
                return { ok: false, error: "VALUE_BELOW_MINIMUM", bounds: { min: entry.min, max: entry.max } };
            }
            if (entry.max !== undefined && parsedVal > entry.max) {
                return { ok: false, error: "VALUE_EXCEEDS_MAXIMUM", bounds: { min: entry.min, max: entry.max } };
            }
            break;
        }
        case "enum": {
            const str = String(value);
            if (!entry.enum.includes(str)) {
                return { ok: false, error: "INVALID_ENUM_VALUE", bounds: { enum: entry.enum } };
            }
            parsedVal = str;
            break;
        }
        case "string": {
            parsedVal = String(value);
            break;
        }
        default:
            break;
    }

    return { ok: true, value: parsedVal };
}

/**
 * Returns schema metadata filtered for frontend exposure.
 */
function getExposedSchema() {
    const out = {};
    for (const [k, entry] of Object.entries(SCHEMA)) {
        if (entry.exposeToFrontend) {
            const { storage, ...publicMeta } = entry;
            out[k] = publicMeta;
        }
    }
    return out;
}

module.exports = {
    SCHEMA,
    validate,
    getExposedSchema
};
