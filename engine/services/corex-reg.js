"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");
const { validateStrategyCode } = require("@utils/security");

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function usage() {
    return [
        "Usage:",
        "  node engine/services/corex-reg.js <StrategyName> <FilePath>",
        "",
        "Example:",
        "  node engine/services/corex-reg.js TrendFollower ./strategies/trend_follower.js"
    ].join("\n");
}

async function upsertStrategy({ name, code, hash }) {
    const { rows } = await db.query(
        `INSERT INTO strategies (name, script_body, script_hash, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (name) DO UPDATE
         SET script_body = EXCLUDED.script_body,
             script_hash = EXCLUDED.script_hash,
             updated_at = NOW()
         RETURNING id`,
        [name, code, hash]
    );
    return rows[0]?.id || null;
}

/**
 * Reads a strategy file, hashes its content, and upserts it into the
 * `strategies` table, including the full script body and its hash.
 * This is the canonical way to get strategy code into the database for
 * the DB-centric loading workflow.
 *
 * @param {string} name - The unique name for the strategy.
 * @param {string} filePath - The path to the strategy's .js file.
 * @returns {Promise<object>}
 */
async function registerStrategy(name, filePath) {
    const strategyName = String(name || "").trim();
    const resolvedPath = path.resolve(String(filePath || "").trim());

    if (!strategyName || !resolvedPath) {
        throw new Error("INVALID_ARGS");
    }

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`FILE_NOT_FOUND: ${resolvedPath}`);
    }

    const code = fs.readFileSync(resolvedPath, "utf8");

    // Perform static analysis to block globals/dangerous patterns before DB insertion
    if (!validateStrategyCode(code)) {
        throw new Error("SECURITY_VALIDATION_FAILED: Code contains forbidden patterns (globals, requires, etc.)");
    }

    const hash = sha256(Buffer.from(code));

    const strategyId = await upsertStrategy({
        name: strategyName,
        code: code,
        hash: hash
    });

    if (!strategyId) {
        throw new Error("STRATEGY_UPSERT_FAILED");
    }

    return {
        strategyId,
        hash,
        filePath: resolvedPath
    };
}

async function main() {
    const [, , name, filePath] = process.argv;

    if (!name || !filePath) {
        console.error(usage());
        process.exit(1);
    }

    try {
        const result = await registerStrategy(name, filePath);
        console.log(
            `Strategy '${name}' registered/updated in DB. ` +
            `hash=${result.hash} path=${result.filePath}`
        );
        await db.close();
        process.exit(0);
    } catch (err) {
        console.error(`Registration failed: ${err.message}`);
        logger.error(`[REG] ${err.message}`);
        await db.close();
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    registerStrategy
};
