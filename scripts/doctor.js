"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const { loadConfig } = require("../engine/kernel/Config");
const { createDb } = require("../engine/db/postgres");
const { runPreflight } = require("../engine/kernel/Preflight");

async function runDoctor() {
    const config = loadConfig(process.env);
    const db = createDb({ env: process.env });

    const preflight = await runPreflight({ config, db });

    console.log("CoreX Kernel Preflight Doctor Report\n");

    for (const check of preflight.checks) {
        const badge = check.status === "ok"
            ? "[OK]  "
            : check.status === "warn"
            ? "[WARN]"
            : "[FAIL]";

        let line = `${badge} ${check.what}`;
        if (check.where) {
            line += ` (at ${check.where})`;
        }
        if (check.fix) {
            line += ` — Fix: ${check.fix}`;
        }
        console.log(line);
    }

    console.log(`\nPreflight Doctor Result: ${preflight.ok ? "PASS" : "FAIL"}`);

    if (!preflight.ok) {
        process.exit(1);
    }
}

if (require.main === module) {
    runDoctor().catch((err) => {
        console.error("Doctor error:", err.message);
        process.exit(1);
    });
}

module.exports = { runDoctor };
