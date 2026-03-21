"use strict";

const fs = require("fs");
const path = require("path");
const {
    getStrategyManifestPayload
} = require("../utils/strategy/StrategyManifest");

function main() {
    const outputPath = path.resolve(__dirname, "../corex-ui/src/monaco/strategyManifest.generated.json");
    const payload = getStrategyManifestPayload();

    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    process.stdout.write(`[corex] strategy manifest synced -> ${outputPath}\n`);
}

main();
