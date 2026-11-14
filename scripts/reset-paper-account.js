"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const { parseArgs, requiresEngine } = require("./lib/scriptArgs");
const logger = require("../utils/logger");
const log = logger.createModuleLogger("SCRIPT:reset-paper-account");

async function main(args) {
    const userId = String(args._positional?.[0] || "").trim();
    const initialCash = args._positional?.[1] !== undefined ? Number(args._positional[1]) : null;

    if (!userId || userId === "default") {
        console.error("ERROR: A specific userId is required.");
        console.error("You can find the userId in the application logs, for example:");
        console.error("  [COREX] info: WS Client Connected [IP: ::1] [user=8bb1780d-977e-4075-8525-312035860760]");
        process.exit(1);
    }

    const pgStore = require("@core/services/pgStore");
    const db = require("@core/services/postgres");

    const persisted = await pgStore.getBrokerSettingsForUser(userId, "paper");
    const cashValue = Number.isFinite(initialCash)
        ? initialCash
        : Number(persisted?.initialCash || persisted?.cash || 0);

    if (!Number.isFinite(cashValue) || cashValue <= 0) {
        console.error(`ERROR: No persisted paper account found for user '${userId}'.`);
        process.exit(1);
    }

    console.log(`Resetting persisted paper account for ${userId} → $${cashValue.toFixed(2)}`);
    console.log("Note: this updates the stored account; it applies the next time a PAPER runtime boots.");
    console.log("Use POST /api/system/account/paper/reset to reset an account that is live in the running engine.");

    await pgStore.upsertBrokerSettingsForUser(userId, "paper", {
        cash: cashValue,
        initialCash: cashValue,
        config: persisted?.config || {}
    });

    console.log("✅ Persisted paper account reset.");
    await db.end();
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2), {});
    main(args).catch(err => {
        log.error(err.message);
        process.exit(1);
    });
}
