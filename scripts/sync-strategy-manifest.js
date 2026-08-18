"use strict";

require("module-alias/register");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("@core/services/postgres");
const {
    getStrategyManifestPayload
} = require("@utils/strategy/StrategyManifest");

function writeManifest() {
    const outputPath = path.resolve(__dirname, "../corex-ui/src/monaco/strategyManifest.generated.json");
    const payload = getStrategyManifestPayload();
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    process.stdout.write(`[corex] strategy manifest synced -> ${outputPath}\n`);
}

async function writeSchemas() {
    const outputPath = path.resolve(__dirname, "../corex-ui/src/monaco/strategySchemas.generated.json");

    if (!db.hasDbConfig()) {
        fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), schemas: {} }, null, 2)}\n`, "utf8");
        process.stdout.write(`[corex] strategy schemas synced (no DB) -> ${outputPath}\n`);
        return;
    }

    try {
        const { rows } = await db.query(
            "SELECT name, schema FROM strategies WHERE schema IS NOT NULL AND schema != '{}'::jsonb"
        );
        const schemas = {};
        for (const row of rows || []) {
            const name = String(row.name || "").trim();
            if (!name) continue;
            try {
                schemas[name] = JSON.parse(row.schema);
            } catch {
                schemas[name] = row.schema;
            }
        }
        const payload = {
            generatedAt: new Date().toISOString(),
            schemas
        };
        fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        process.stdout.write(`[corex] strategy schemas synced (${Object.keys(schemas).length} entries) -> ${outputPath}\n`);
    } catch (err) {
        fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), schemas: {}, error: err.message }, null, 2)}\n`, "utf8");
        process.stdout.write(`[corex] strategy schemas sync failed: ${err.message}\n`);
    }
}

async function main() {
    writeManifest();
    await writeSchemas();
}

main().catch((err) => {
    console.error("[corex] sync failed:", err.message);
    process.exit(1);
});
