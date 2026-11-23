"use strict";

const fs = require("fs");
const path = require("path");

const srcRoot = path.resolve(__dirname, "../../src");
const baseline = require("./debt-baseline.json");

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? sourceFiles(full) : (entry.name.endsWith(".js") ? [full] : []);
    });
}

function countPattern(pattern) {
    let count = 0;
    for (const file of sourceFiles(srcRoot)) {
        const source = fs.readFileSync(file, "utf8");
        count += [...source.matchAll(pattern)].length;
    }
    return count;
}

describe("source debt ratchet", () => {
    test.each([
        ["array shift calls", /\.shift\s*\(/g, baseline.shiftCalls],
        ["wall-clock reads", /Date\.now\s*\(/g, baseline.dateNowCalls],
        ["fixed-decimal conversions", /\.toFixed\s*\(/g, baseline.toFixedCalls],
        ["application alias requires", /require\(\s*["']@/g, baseline.aliasRequires]
    ])("%s never increases above the accepted baseline", (_label, pattern, accepted) => {
        expect(countPattern(pattern)).toBeLessThanOrEqual(accepted);
    });
});