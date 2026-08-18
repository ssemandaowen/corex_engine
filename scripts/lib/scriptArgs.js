"use strict";

function parseArgs(argv, schema = {}) {
    const out = {};
    const flags = new Set();
    const positional = [];

    const definedKeys = new Set();
    const definedFlags = new Set();
    for (const [key, def] of Object.entries(schema)) {
        if (def && def.flag) definedFlags.add(key);
        else definedKeys.add(key);
    }

    let i = 0;
    while (i < argv.length) {
        const token = argv[i];
        if (!String(token).startsWith("--")) {
            positional.push(token);
            i++;
            continue;
        }
        const name = token.slice(2);
        if (!name) { i++; continue; }
        if (definedFlags.has(name)) {
            out[name] = true;
            flags.add(name);
            i++;
            continue;
        }
        if (definedKeys.has(name)) {
            const next = argv[i + 1];
            if (next === undefined || String(next).startsWith("--")) {
                out[name] = schema[name]?.default ?? true;
                i++;
                continue;
            }
            out[name] = coerce(next, schema[name]);
            i += 2;
            continue;
        }
        i++;
    }

    for (const key of definedFlags) {
        if (!(key in out)) out[key] = false;
    }
    for (const [key, def] of Object.entries(schema)) {
        if (def && !(key in out) && "default" in def) {
            out[key] = def.default;
        }
    }

    out._positional = positional;
    out._flags = Array.from(flags);
    return out;
}

function coerce(value, def) {
    if (!def || def.type === undefined || def.type === "string") return String(value);
    if (def.type === "number") {
        const n = Number(value);
        return Number.isFinite(n) ? n : (def.default ?? 0);
    }
    if (def.type === "integer") {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : (def.default ?? 0);
    }
    if (def.type === "boolean") {
        return ["true", "1", "yes"].includes(String(value).toLowerCase());
    }
    return String(value);
}

async function requiresEngine() {
    try {
        const { hasDbConfig } = require("@core/services/postgres");
        if (!hasDbConfig()) {
            console.error("ERROR: CoreX engine must be running (DATABASE_URL or PGHOST not configured). Start it with: node index.js");
            process.exit(1);
        }
    } catch {
        console.error("ERROR: CoreX engine must be running. Start it with: node index.js");
        process.exit(1);
    }
}

module.exports = { parseArgs, requiresEngine };
