"use strict";

require("module-alias/register");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");

const STRATEGIES_DIR = path.join(process.cwd(), "strategies");

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function upsertStrategy(name, body, hash) {
    const { rows } = await db.query(
        `INSERT INTO strategies (name, script_body, script_hash, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (name) DO UPDATE
         SET script_body = EXCLUDED.script_body,
             script_hash = EXCLUDED.script_hash,
             updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [name, body, hash]
    );
    return rows[0]?.id || null;
}

async function run() {
    if (!fs.existsSync(STRATEGIES_DIR)) {
        logger.warn(`[DB] Strategies directory missing: ${STRATEGIES_DIR}`);
        return;
    }

    const files = fs.readdirSync(STRATEGIES_DIR).filter((f) => f.endsWith(".js"));
    if (files.length === 0) {
        logger.warn("[DB] No .js strategies found to migrate.");
        return;
    }

    let migrated = 0;
    for (const file of files) {
        const filePath = path.join(STRATEGIES_DIR, file);
        const name = path.basename(file, ".js");
        const buffer = fs.readFileSync(filePath);
        const body = buffer.toString("utf8");
        const hash = sha256(buffer);
        await upsertStrategy(name, body, hash);
        migrated += 1;
        logger.info(`[DB] Strategy migrated: ${name} (${hash})`);
    }

    logger.info(`[DB] Strategy migration complete. Migrated=${migrated}`);
}

if (require.main === module) {
    run()
        .then(async () => {
            await db.close();
            process.exit(0);
        })
        .catch(async (err) => {
            logger.error(`[DB] Strategy migration failed: ${err.message}`);
            await db.close();
            process.exit(1);
        });
}

module.exports = { run };
