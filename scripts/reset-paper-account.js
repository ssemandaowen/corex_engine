"use strict";

/**
 * Resets a paper trading account to its default state.
 *
 * Usage:
 * node scripts/reset-paper-account.js <userId> [initialCash]
 *
 * or with npm:
 * npm run account:reset -- <userId> [initialCash]
 *
 * Arguments:
 *   <userId>      - The ID of the user whose paper account should be reset.
 *                   You can find this in the logs (e.g., "WS Client Connected [user=...]")
 *   [initialCash] - (Optional) A new initial cash balance for the account.
 *                   Defaults to the value in your .env or 100000.
 */

require("module-alias/register");

// dotenv is used in the main app, so we should use it here too
// to ensure consistency, e.g., for database connection strings.
require("dotenv").config();

const { getPaperBroker } = require("@broker/paperStore");
const db = require('@core/services/postgres');
const logger = require('@utils/logger');

// Disable the main logger to keep the script output clean
logger.transports.forEach((t) => (t.silent = true));

async function resetPaperAccount(userId, initialCash) {
    if (!userId || userId === 'default') {
        console.error("ERROR: A specific userId is required.");
        console.error("You can find the userId in the application logs, for example:");
        console.error("  [COREX] info: WS Client Connected [IP: ::1] [user=8bb1780d-977e-4075-8525-312035860760]");
        process.exit(1);
    }
    
    console.log(`Attempting to reset paper account for user: ${userId}`);
    
    // Get the broker instance. This will either create a new one or get the cached one.
    // The paperStore will load its state from the database.
    const paperBroker = getPaperBroker(userId);

    const cashValue = initialCash ? parseFloat(initialCash) : paperBroker.initialCash;

    console.log(`Setting initial cash to: $${cashValue.toFixed(2)}`);

    // Reset the account state in memory
    paperBroker.resetAccount(cashValue);

    console.log("Account has been reset in memory. Persisting changes to the database...");

    // The resetAccount() method queues a persistence operation.
    // We need to give it a moment to complete before exiting the script.
    // A more robust solution might involve exposing a promise from the persist queue,
    // but for a CLI script, a short delay is sufficient.
    await new Promise(resolve => setTimeout(resolve, 1500));

    console.log("✅ Account reset successfully.");

    // The database connection must be closed, otherwise the script will hang.
    await db.end();
}

const userIdArg = process.argv[2];
const cashArg = process.argv[3];

resetPaperAccount(userIdArg, cashArg).catch(err => {
    console.error("❌ An error occurred while resetting the account:");
    console.error(err);
    db.end().finally(() => process.exit(1));
});
