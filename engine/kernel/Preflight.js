"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");

// Ensure module-alias is registered
try {
    require("module-alias/register");
} catch (_) {}

function _scanFileForAliasRequires(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf8");
        // Regex matching require("@...") or require("corex-...")
        const regex = /require\s*\(\s*["'](@[a-zA-Z0-9_\-\/]+|corex-[a-zA-Z0-9_\-\/]+)["']\s*\)/g;
        const matches = [];
        let match;
        while ((match = regex.exec(content)) !== null) {
            matches.push(match[1]);
        }
        return matches;
    } catch (_) {
        return [];
    }
}

function _collectJsFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;

    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            if (item.name === "node_modules" || item.name === ".git" || item.name === "dist") continue;
            _collectJsFiles(fullPath, fileList);
        } else if (item.isFile() && item.name.endsWith(".js") && !item.name.endsWith(".test.js")) {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

async function _checkPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.on("error", () => resolve(false));
        server.listen(port, () => {
            server.close(() => resolve(true));
        });
    });
}

async function runPreflight({ config = {}, root = null, db = null, scanDirs = null } = {}) {
    const checks = [];
    const rootDir = process.cwd();

    // ─────────────────────────────────────────────────────────────────────────
    // Check (a): Alias Specifier Resolution Scan
    // ─────────────────────────────────────────────────────────────────────────
    const dirsToScan = scanDirs || [
        path.join(rootDir, "engine"),
        path.join(rootDir, "utils"),
        path.join(rootDir, "packages")
    ];

    let aliasFailures = 0;

    for (const targetDir of dirsToScan) {
        if (!fs.existsSync(targetDir)) continue;
        const jsFiles = _collectJsFiles(targetDir);

        for (const filePath of jsFiles) {
            const specifiers = _scanFileForAliasRequires(filePath);
            const fileDir = path.dirname(filePath);

            for (const specifier of specifiers) {
                try {
                    require.resolve(specifier, { paths: [fileDir, rootDir] });
                } catch (err) {
                    aliasFailures++;
                    const relPath = path.relative(rootDir, filePath);
                    checks.push({
                        id: "check_alias_resolution",
                        status: "fail",
                        what: `Unresolved alias specifier '${specifier}'`,
                        where: relPath,
                        fix: `Add mapping for '${specifier}' to package.json _moduleAliases or correct require statement`
                    });
                }
            }
        }
    }

    if (aliasFailures === 0) {
        checks.push({
            id: "check_alias_resolution",
            status: "ok",
            what: "All module alias require specifiers resolve successfully",
            where: "engine/, packages/, utils/",
            fix: null
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Check (b): Folder Permissions
    // ─────────────────────────────────────────────────────────────────────────
    const folders = config.folders || {
        data: path.join(rootDir, "data"),
        uploads: path.join(rootDir, "data", "uploads"),
        reports: path.join(rootDir, "data", "reports"),
        backtests: path.join(rootDir, "data", "backtests")
    };

    let folderFailures = 0;
    for (const [name, folderPath] of Object.entries(folders)) {
        try {
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
            }
            fs.accessSync(folderPath, fs.constants.W_OK);
        } catch (err) {
            folderFailures++;
            checks.push({
                id: "check_folder_permissions",
                status: "fail",
                what: `Directory '${name}' is not writable or cannot be created`,
                where: folderPath,
                fix: `Check directory permissions or set COREX_DATA_PATH env variable`
            });
        }
    }

    if (folderFailures === 0) {
        checks.push({
            id: "check_folder_permissions",
            status: "ok",
            what: "All required directories exist and are writable",
            where: "data/, uploads/, reports/, backtests/",
            fix: null
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Check (c): Required Config Keys
    // ─────────────────────────────────────────────────────────────────────────
    const isProd = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
    const requiredKeys = [
        { key: "JWT_SECRET", desc: "JWT signing secret" },
        { key: "COREX_SECRETS_KEY", desc: "Secrets vault key" },
        { key: "AUTH_KEY_PEPPER", desc: "API key pepper" }
    ];

    let missingProdKeys = 0;
    for (const { key, desc } of requiredKeys) {
        if (!process.env[key] || !process.env[key].trim()) {
            if (isProd) {
                missingProdKeys++;
                checks.push({
                    id: "check_required_config",
                    status: "fail",
                    what: `Missing production secret '${key}' (${desc})`,
                    where: "process.env",
                    fix: `Set ${key} in environment before running in production mode`
                });
            } else {
                checks.push({
                    id: "check_required_config",
                    status: "warn",
                    what: `Missing secret '${key}' (${desc}) — using dev fallback`,
                    where: "process.env",
                    fix: `Set ${key} in environment for production deployments`
                });
            }
        }
    }

    if (missingProdKeys === 0 && isProd) {
        checks.push({
            id: "check_required_config",
            status: "ok",
            what: "All production security keys present in environment",
            where: "process.env",
            fix: null
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Check (d): Database Connection Ping
    // ─────────────────────────────────────────────────────────────────────────
    if (!db || !db.configured) {
        if (config.dbRequired) {
            checks.push({
                id: "check_database_ping",
                status: "fail",
                what: "Database is not configured but COREX_DB_REQUIRED is enabled",
                where: "engine/db/postgres",
                fix: "Set DATABASE_URL or PGHOST in environment"
            });
        } else {
            checks.push({
                id: "check_database_ping",
                status: "warn",
                what: "Database is unconfigured (running in off-line mode)",
                where: "engine/db/postgres",
                fix: "Set DATABASE_URL or PGHOST to enable database features"
            });
        }
    } else {
        const pingOk = await db.ping(2000);
        if (pingOk) {
            checks.push({
                id: "check_database_ping",
                status: "ok",
                what: "Database ping succeeded",
                where: "PostgreSQL",
                fix: null
            });
        } else {
            const status = config.dbRequired ? "fail" : "warn";
            checks.push({
                id: "check_database_ping",
                status,
                what: "Database ping failed (server unreachable or timeout)",
                where: "PostgreSQL",
                fix: "Verify PostgreSQL service is running and credentials are valid"
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Check (e): Port Free
    // ─────────────────────────────────────────────────────────────────────────
    const targetPort = config.port || 3000;
    const isPortFree = await _checkPortFree(targetPort);

    if (isPortFree) {
        checks.push({
            id: "check_port_free",
            status: "ok",
            what: `Port ${targetPort} is free`,
            where: `0.0.0.0:${targetPort}`,
            fix: null
        });
    } else {
        checks.push({
            id: "check_port_free",
            status: "fail",
            what: `Port ${targetPort} is already in use`,
            where: `0.0.0.0:${targetPort}`,
            fix: `Kill the process currently listening on port ${targetPort} or set PORT env`
        });
    }

    const overallOk = !checks.some((c) => c.status === "fail");

    return {
        ok: overallOk,
        checks
    };
}

module.exports = { runPreflight };
