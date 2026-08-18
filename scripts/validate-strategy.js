"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const { parseArgs } = require("./lib/scriptArgs");
const logger = require("../utils/logger");
const log = logger.createModuleLogger("SCRIPT:validate-strategy");

async function main(args) {
    const filePath = String(args._positional?.[0] || "").trim();
    const validateAll = args._flags.includes("all");
    const verbose = args._flags.includes("verbose");

    if (!filePath && !validateAll) {
        console.log("Usage:");
        console.log("  node scripts/validate-strategy.js <strategy-file>");
        console.log("  node scripts/validate-strategy.js --all");
        process.exit(0);
    }

    const StrategyValidator = require("../utils/strategy/StrategyValidator");
    const path = require("path");
    const fs = require("fs");
    const colors = {
        reset: "\x1b[0m", bright: "\x1b[1m",
        red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m"
    };
    const colorize = (text, color) => `${colors[color]}${text}${colors.reset}`;

    function printResult(result) {
        const { summary, errors, warnings, info } = result;
        const statusColor = summary.status === "PASS" ? "green" : "red";
        console.log(colorize(`Status: ${summary.status}`, statusColor));
        console.log(colorize(`Grade: ${summary.grade}`, summary.grade.startsWith("A") ? "green" : summary.grade.startsWith("B") ? "yellow" : "red"));
        if (errors.length) console.log(colorize("ERRORS:", "red"), ...errors.map(e => `  [${e.code}] ${e.message}${e.fix ? " — Fix: " + e.fix : ""}`));
        if (warnings.length) console.log(colorize("WARNINGS:", "yellow"), ...warnings.map(w => `  [${w.code}] ${w.message}${w.fix ? " — Fix: " + w.fix : ""}`));
        if (verbose && info.length) console.log(colorize("INFO:", "cyan"), ...info.map(i => `  [${i.code}] ${i.message}`));
    }

    async function validateFile(fp) {
        console.log(colorize(`Validating: ${fp}`, "cyan"));
        const result = await StrategyValidator.validateFile(fp);
        printResult(result);
        return result.valid;
    }

    const strategiesDir = path.join(process.cwd(), "strategies");
    if (validateAll) {
        if (!fs.existsSync(strategiesDir)) { console.error(colorize("Error: strategies/ not found", "red")); process.exit(1); }
        const files = fs.readdirSync(strategiesDir).filter(f => f.endsWith(".js") && !f.endsWith(".test.js"));
        let passed = 0;
        for (const file of files) { if (await validateFile(path.join(strategiesDir, file))) passed++; }
        console.log(colorize(`\nResult: ${passed}/${files.length} passed`, passed === files.length ? "green" : "red"));
        process.exit(passed === files.length ? 0 : 1);
    }

    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) { console.error(colorize(`Error: File not found: ${resolved}`, "red")); process.exit(1); }
    process.exit(await validateFile(resolved) ? 0 : 1);
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2), {});
    main(args).catch(err => { log.error(err.message); process.exit(1); });
}

module.exports = { main };
