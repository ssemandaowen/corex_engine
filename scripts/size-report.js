"use strict";

/**
 * J4 — Size report.
 *
 * Prints files over 400 lines (warn) and over 700 lines (needs review)
 * in engine/, packages/, and utils/. Report only — exits 0 always so it
 * does not fail CI.
 *
 * Usage: node scripts/size-report.js [rootDir]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WARN = 400;
const REVIEW = 700;
const SCAN_DIRS = ["engine", "packages", "utils"];

function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
}

function lineCount(file) {
    const src = fs.readFileSync(file, "utf8");
    return src.split("\n").length;
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;

const rows = [];
for (const dirName of SCAN_DIRS) {
    const dir = path.join(target, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
        const lines = lineCount(file);
        if (lines > WARN) {
            rows.push({
                file: path.relative(target, file).split(path.sep).join("/"),
                lines,
                level: lines > REVIEW ? "NEEDS REVIEW" : "warn",
            });
        }
    }
}

rows.sort((a, b) => b.lines - a.lines);

console.log(`Size report (warn > ${WARN} lines, needs review > ${REVIEW} lines)`);
console.log(`Scanned: ${SCAN_DIRS.join(", ")}`);
console.log(`Files over ${WARN} lines: ${rows.length}`);
console.log("");
if (rows.length === 0) {
    console.log("  (none)");
} else {
    for (const r of rows) {
        console.log(`  [${r.level}] ${r.lines}\t${r.file}`);
    }
}

// Report only — never fail CI.
process.exit(0);
