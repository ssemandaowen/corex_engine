"use strict";

require("module-alias/register");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("@core/services/postgres");
const logger = require("@utils/logger");

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes("--apply") ? false : true;
const DAYS = Number(process.env.COREX_PRUNE_DAYS || 14);

const TARGETS = [
    path.join(ROOT, "data", "backtests"),
    path.join(ROOT, "data", "cache"),
    path.join(ROOT, "logs")
];

function stale(file, now) {
    const ageMs = now - fs.statSync(file).mtimeMs;
    return ageMs > DAYS * 24 * 60 * 60 * 1000;
}

function removeFile(filePath) {
    if (DRY_RUN) return;
    fs.rmSync(filePath, { recursive: true, force: true });
}

function pruneFilesystem() {
    const now = Date.now();
    const report = { scanned: 0, stale: 0, removed: 0, skipped: 0 };

    for (const target of TARGETS) {
        if (!fs.existsSync(target)) continue;
        const items = fs.readdirSync(target, { withFileTypes: true });
        for (const item of items) {
            const filePath = path.join(target, item.name);
            report.scanned += 1;
            try {
                if (!stale(filePath, now)) {
                    report.skipped += 1;
                    continue;
                }
                report.stale += 1;
                removeFile(filePath);
                report.removed += 1;
            } catch {
                report.skipped += 1;
            }
        }
    }

    return report;
}

async function optimizeDb() {
    if (!db.hasDbConfig()) return { skipped: true, reason: "DB_NOT_CONFIGURED" };
    if (DRY_RUN) return { skipped: true, reason: "DRY_RUN" };

    const statements = [
        "VACUUM ANALYZE orders",
        "VACUUM ANALYZE paper_trades",
        "VACUUM ANALYZE strategy_signals",
        "VACUUM ANALYZE strategy_ticks",
        "VACUUM ANALYZE execution_events"
    ];

    const executed = [];
    for (const sql of statements) {
        try {
            await db.query(sql);
            executed.push(sql);
        } catch {
            // ignore optional tables
        }
    }
    return { skipped: false, executed };
}

async function run() {
    const fsReport = pruneFilesystem();
    const dbReport = await optimizeDb();
    logger.info(`[PRUNE] mode=${DRY_RUN ? "DRY_RUN" : "APPLY"} days=${DAYS} fs=${JSON.stringify(fsReport)} db=${JSON.stringify(dbReport)}`);
    return { dryRun: DRY_RUN, days: DAYS, fsReport, dbReport };
}

if (require.main === module) {
    run()
        .then(async () => {
            await db.close();
            process.exit(0);
        })
        .catch(async (err) => {
            logger.error(`[PRUNE] failed: ${err.message}`);
            await db.close();
            process.exit(1);
        });
}

module.exports = { run };

