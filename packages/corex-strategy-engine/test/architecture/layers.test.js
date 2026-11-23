"use strict";

const fs = require("fs");
const path = require("path");

const srcRoot = path.resolve(__dirname, "../../src");

function filesUnder(relativeDir) {
    const root = path.join(srcRoot, relativeDir);
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(root, entry.name);
        return entry.isDirectory()
            ? filesUnder(path.relative(srcRoot, full))
            : (entry.name.endsWith(".js") ? [full] : []);
    });
}

function importsOf(file) {
    const source = fs.readFileSync(file, "utf8");
    return [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
}

function assertLocalLayer(relativeDir, allowedRoots) {
    const layerRoot = path.join(srcRoot, relativeDir);
    for (const file of filesUnder(relativeDir)) {
        for (const specifier of importsOf(file)) {
            expect(specifier.startsWith(".")).toBe(true);
            const resolved = path.resolve(path.dirname(file), specifier);
            const allowed = allowedRoots.some(root => {
                const absolute = path.join(srcRoot, root);
                const rel = path.relative(absolute, resolved);
                return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
            });
            expect(allowed).toBe(true);
            const relative = path.relative(layerRoot, file);
            expect(relative.startsWith("..")).toBe(false);
        }
    }
}

describe("strategy-engine source layer boundaries", () => {
    test("parameter layer is self-contained", () => {
        assertLocalLayer("params", ["params"]);
    });

    test("smoothing cores depend only on core and kernel primitives", () => {
        assertLocalLayer("indicators/core", ["indicators/core", "kernel"]);
    });

    test("indicator implementations do not depend on application or orchestration layers", () => {
        const forbidden = /^(?:@(?:core|utils|config|broker|events)|(?:engine|routes|workers|controllers)\/)/;
        for (const file of filesUnder("indicators")) {
            for (const specifier of importsOf(file)) expect(forbidden.test(specifier)).toBe(false);
        }
    });

    test("manager, registry and bank remain package-local", () => {
        for (const name of ["IndicatorManager.js", "IndicatorRegistry.js", "IndicatorBank.js"]) {
            const file = path.join(srcRoot, name);
            for (const specifier of importsOf(file)) expect(specifier.startsWith(".")).toBe(true);
        }
    });
});