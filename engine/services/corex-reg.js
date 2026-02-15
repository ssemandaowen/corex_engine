"use strict";

require("module-alias/register");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function usage() {
    return [
        "Usage:",
        "  node engine/services/corex-reg.js <StrategyName> <FilePath> <VersionTag>",
        "",
        "Example:",
        "  node engine/services/corex-reg.js TrendFollower ./strategies/trend_follower.js v1.0.2"
    ].join("\n");
}

async function upsertStrategy(name) {
    const { rows } = await db.query(
        `INSERT INTO strategies (name)
         VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name]
    );
    return rows[0]?.id || null;
}

async function upsertStrategyVersion({ strategyId, versionTag, sourceHash, filePath }) {
    const { rows: existing } = await db.query(
        `SELECT id FROM strategy_versions
         WHERE strategy_id = $1 AND version_tag = $2
         LIMIT 1`,
        [strategyId, versionTag]
    );

    if (existing[0]?.id) {
        await db.query(
            `UPDATE strategy_versions
             SET source_hash = $1, file_path = $2, created_at = NOW()
             WHERE id = $3`,
            [sourceHash, filePath, existing[0].id]
        );
        return { id: existing[0].id, action: "updated" };
    }

    const { rows } = await db.query(
        `INSERT INTO strategy_versions (strategy_id, version_tag, source_hash, file_path)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [strategyId, versionTag, sourceHash, filePath]
    );
    return { id: rows[0]?.id || null, action: "inserted" };
}

async function registerStrategy(name, filePath, versionTag) {
    const strategyName = String(name || "").trim();
    const version = String(versionTag || "").trim();
    const resolvedPath = path.resolve(String(filePath || "").trim());

    if (!strategyName || !version || !resolvedPath) {
        throw new Error("INVALID_ARGS");
    }

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`FILE_NOT_FOUND: ${resolvedPath}`);
    }

    const buffer = fs.readFileSync(resolvedPath);
    const hash = sha256(buffer);

    const strategyId = await upsertStrategy(strategyName);
    if (!strategyId) {
        throw new Error("STRATEGY_UPSERT_FAILED");
    }

    const versionResult = await upsertStrategyVersion({
        strategyId,
        versionTag: version,
        sourceHash: hash,
        filePath: resolvedPath
    });

    return {
        strategyId,
        versionId: versionResult.id,
        versionAction: versionResult.action,
        hash,
        filePath: resolvedPath
    };
}

async function main() {
    const [, , name, filePath, versionTag] = process.argv;

    if (!name || !filePath || !versionTag) {
        console.error(usage());
        process.exit(1);
    }

    try {
        const result = await registerStrategy(name, filePath, versionTag);
        console.log(
            `Strategy ${name} (${versionTag}) ${result.versionAction}. ` +
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
