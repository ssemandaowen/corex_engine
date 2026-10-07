"use strict";

const path = require("path");

function _envTrue(val) {
    if (val == null) return false;
    return ["1", "true", "yes", "on"].includes(String(val).trim().toLowerCase());
}

function loadConfig(env = process.env) {
    const rawPort = env.PORT != null ? Number(env.PORT) : 3000;
    const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 3000;

    const dbRequired = _envTrue(env.COREX_DB_REQUIRED);
    const dbConfigured = !!(env.DATABASE_URL || env.PGHOST);

    const rootDataDir = env.COREX_DATA_PATH
        ? path.resolve(env.COREX_DATA_PATH)
        : path.join(process.cwd(), "data");

    const config = {
        port,
        dbRequired,
        db: Object.freeze({
            configured: dbConfigured,
            host: env.PGHOST || "",
            port: Number(env.PGPORT || 5432),
            user: env.PGUSER || "",
            database: env.PGDATABASE || "",
            url: env.DATABASE_URL || ""
        }),
        folders: Object.freeze({
            data: rootDataDir,
            uploads: path.join(rootDataDir, "uploads"),
            reports: path.join(rootDataDir, "reports"),
            backtests: path.join(rootDataDir, "backtests")
        })
    };

    return Object.freeze(config);
}

module.exports = { loadConfig };
