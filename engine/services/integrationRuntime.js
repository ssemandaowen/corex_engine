"use strict";

const logger = require("@utils/logger");
const configService = require("@core/services/configService");
const { bus, EVENTS } = require("@events/bus");

const log = logger.createModuleLogger("INTEGRATIONS", { category: "system" });

let initialized = false;

const toBool = (value, fallback = false) => {
    if (typeof value === "boolean") return value;
    if (value == null) return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

function applyEnvVar(key, value) {
    if (value === undefined || value === null) return;
    const asString = String(value);
    if (!asString.length) return;
    process.env[key] = asString;
}

function readConfig() {
    const get = typeof configService.getSync === "function" ? configService.getSync : () => undefined;
    const uiIntegrations = get("ui.integrations", {}) || {};
    const run = get("run", {}) || {};
    return { uiIntegrations, run };
}

async function refresh() {
    try {
        const { uiIntegrations, run } = readConfig();
        const marketData = uiIntegrations.marketData || {};
        const metaApi = uiIntegrations.metaApi || {};
        const mt5Bridge = uiIntegrations.mt5Bridge || {};

        applyEnvVar("TWELVE_DATA_KEY", marketData.twelveDataApiKey);
        applyEnvVar("COREX_MARKET_WS_ENABLED", toBool(marketData.websocketEnabled, true) ? "true" : "false");

        applyEnvVar("METAAPI_ACCOUNT_ID", metaApi.accountId);
        applyEnvVar("METAAPI_TOKEN", metaApi.token);
        applyEnvVar("METAAPI_SERVER", metaApi.server);

        applyEnvVar("COREX_BRIDGE_PROVIDER", run.activeBridgeProvider || mt5Bridge.activeBridgeProvider);
        applyEnvVar("MT5_BRIDGE_TOKEN", mt5Bridge.bridgeToken);
        applyEnvVar("COREX_MT5_HTTP_TOKEN", mt5Bridge.httpToken);
        applyEnvVar("COREX_MT5_BRIDGE_HOST", mt5Bridge.host);
        applyEnvVar("COREX_MT5_BRIDGE_PORT", mt5Bridge.port);
        applyEnvVar("COREX_MT5_HEARTBEAT_MS", mt5Bridge.heartbeatMs);

        const marketBroker = require("@broker/twelvedata");
        if (typeof marketBroker.applyRuntimeConfig === "function") {
            marketBroker.applyRuntimeConfig({
                apiKey: marketData.twelveDataApiKey,
                websocketEnabled: toBool(marketData.websocketEnabled, true)
            });
        }

        const mt5BridgeSvc = require("@core/services/mt5Bridge");
        if (typeof mt5BridgeSvc.applyRuntimeConfig === "function") {
            mt5BridgeSvc.applyRuntimeConfig({
                bridgeToken: mt5Bridge.bridgeToken,
                httpToken: mt5Bridge.httpToken,
                host: mt5Bridge.host,
                port: mt5Bridge.port,
                heartbeatMs: mt5Bridge.heartbeatMs
            });
        }

        log.info("Connectivity runtime applied");
    } catch (err) {
        log.error(`Integration runtime refresh failed: ${err.message}`);
    }
}

function init() {
    if (initialized) return;
    initialized = true;

    bus.on(EVENTS.SYSTEM.CONFIG_REFRESH, async () => {
        try {
            await configService.refresh();
            await refresh();
        } catch (err) {
            log.error(`Refresh on config event failed: ${err.message}`);
        }
    });
}

module.exports = {
    init,
    refresh
};

