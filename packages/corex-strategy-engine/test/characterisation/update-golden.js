"use strict";

const fs = require("fs");
const path = require("path");
const { captureBarPath, captureTickPath } = require("./paths");

const outputDir = path.join(__dirname, "golden");
fs.mkdirSync(outputDir, { recursive: true });

for (const [name, samples] of [
    ["bar-path.json", captureBarPath()],
    ["tick-path.json", captureTickPath()]
]) {
    const payload = {
        schemaVersion: 1,
        provenance: "characterisation of the current implementation; not an indicator correctness reference",
        samples
    };
    fs.writeFileSync(
        path.join(outputDir, name),
        JSON.stringify(payload, null, 2) + "\n",
        "utf8"
    );
    process.stdout.write(name + ": " + samples.length + " samples written\n");
}
