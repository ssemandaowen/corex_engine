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

    const { getPaperBroker } = require("@broker/paperStore");
    const db = require("@core/services/postgres");

    const paperBroker = getPaperBroker(userId);
    if (!paperBroker) {
        console.error(`ERROR: No paper broker found for user '${userId}'. Is the engine running?`);
        process.exit(1);
    }

    const cashValue = Number.isFinite(initialCash) ? initialCash : paperBroker.initialCash;
    console.log(`Resetting paper account for ${userId} → $${cashValue.toFixed(2)}`);

    paperBroker.resetAccount(cashValue);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log("✅ Account reset successfully.");
    await db.end();
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2), {});
    main(args).catch(err => {
        log.error(err.message);
        process.exit(1);
    });
}
