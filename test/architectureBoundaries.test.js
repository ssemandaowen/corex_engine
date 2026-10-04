"use strict";

/**
 * J4 — Dependency-direction ratchet test.
 *
 * Scans the src folders and index.js of every package and enforces the
 * package dependency boundary. A violation is any require() of:
 *   - @core/...            (engine internals — packages must not depend on engine)
 *   - @utils/...           EXCEPT the foundation allowlist:
 *                            @utils/logger, @utils/metrics, @utils/linkedList,
 *                            @utils/data/fastQueue
 *   - @broker/...          (legacy broker alias)
 *   - @strategies/...      (legacy strategies alias)
 *   - another package's src folder (cross-package deep import)
 *   - a relative path that leaves the package folder
 *
 * Ratchet semantics:
 *   - The CURRENT violations are recorded in test/fixtures/boundaryAllowlist.json.
 *   - The test FAILS if a violation appears that is NOT in the allowlist
 *     (a new boundary violation).
 *   - The test FAILS if an allowlist entry no longer occurs in the source
 *     (so the allowlist can only shrink — fixing a violation requires removing
 *     its allowlist entry in the same change).
 *
 * This test does not fix violations; it stops them from growing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.join(ROOT, "packages");
const ALLOWLIST_PATH = path.join(__dirname, "fixtures", "boundaryAllowlist.json");

const FOUNDATION_ALLOWLIST = new Set([
    "@utils/logger",
    "@utils/metrics",
    "@utils/linkedList",
    "@utils/data/fastQueue",
]);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
}

function packageNames() {
    return fs.readdirSync(PACKAGES, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
}

// Returns a violation object for a require specifier, or null if allowed.
function classify(spec, file, pkgDir, pkgNames) {
    // Relative import: allowed only if it resolves inside the package folder.
    if (spec.startsWith("./") || spec.startsWith("../")) {
        const resolved = path.resolve(path.dirname(file), spec);
        const pkgAbs = path.resolve(pkgDir);
        if (resolved.startsWith(pkgAbs + path.sep) || resolved === pkgAbs) {
            return null; // stays inside the package
        }
        return { module: spec, kind: "relative-leaves-package" };
    }

    // Node builtins and bare npm specifiers (no leading @, no slash) are not
    // boundary violations.
    if (!spec.startsWith("@") && !spec.includes("/")) {
        return null;
    }

    if (spec.startsWith("@core/") || spec === "@core") {
        return { module: spec, kind: "@core" };
    }
    if (spec.startsWith("@broker/") || spec === "@broker") {
        return { module: spec, kind: "@broker (legacy)" };
    }
    if (spec.startsWith("@strategies") || spec === "@strategies") {
        return { module: spec, kind: "@strategies" };
    }
    if (spec.startsWith("@utils/") || spec === "@utils") {
        if (FOUNDATION_ALLOWLIST.has(spec)) return null;
        return { module: spec, kind: "@utils (non-foundation)" };
    }

    // Another package's /src/ (deep cross-package import).
    const other = pkgNames.find((p) => spec === p || spec.startsWith(p + "/"));
    if (other && spec.includes("/src/")) {
        return { module: spec, kind: "cross-package /src/" };
    }

    return null; // public package import (via index) or unrelated — allowed
}

function scanViolations() {
    const pkgNames = packageNames();
    const found = [];
    for (const pkg of pkgNames) {
        const pkgDir = path.join(PACKAGES, pkg);
        const srcDir = path.join(pkgDir, "src");
        const files = [];
        if (fs.existsSync(srcDir)) walk(srcDir, files);
        const indexFile = path.join(pkgDir, "index.js");
        if (fs.existsSync(indexFile)) files.push(indexFile);

        for (const file of files) {
            const rel = path.relative(ROOT, file).split(path.sep).join("/");
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((line, i) => {
                const m = line.match(/require\(\s*["']([^"']+)["']\s*\)/);
                if (!m) return;
                const v = classify(m[1], file, pkgDir, pkgNames);
                if (v) {
                    found.push({
                        file: rel,
                        line: i + 1,
                        module: v.module,
                        kind: v.kind,
                    });
                }
            });
        }
    }
    return found;
}

function key(entry) {
    return `${entry.file}::${entry.line}::${entry.module}::${entry.kind}`;
}

describe("architecture boundaries — package dependency ratchet", () => {
    let found;
    let allowlist;

    beforeAll(() => {
        found = scanViolations();
        allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8")).violations;
    });

    test("no NEW boundary violations beyond the allowlist", () => {
        const allowed = new Set(allowlist.map(key));
        const newViolations = found.filter((v) => !allowed.has(key(v)));
        expect(newViolations).toEqual([]);
    });

    test("allowlist contains no stale entries (every entry still occurs)", () => {
        const foundKeys = new Set(found.map(key));
        const stale = allowlist.filter((v) => !foundKeys.has(key(v)));
        expect(stale).toEqual([]);
    });

    test("allowlist is not empty (ratchet is active)", () => {
        // Guards against an accidental empty allowlist that would let any
        // violation through. If all violations are genuinely fixed, this
        // assertion should be updated to expect an empty list instead.
        expect(allowlist.length).toBeGreaterThan(0);
    });
});
