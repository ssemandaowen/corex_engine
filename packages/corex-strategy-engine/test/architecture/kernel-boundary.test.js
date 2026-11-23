"use strict";

const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "../..");
const kernelRoot = path.join(packageRoot, "src", "kernel");

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? sourceFiles(full) : (entry.name.endsWith(".js") ? [full] : []);
    });
}

describe("kernel dependency boundary", () => {
    test("kernel source requires only other files inside src/kernel", () => {
        const files = sourceFiles(kernelRoot);
        expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            const requires = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)];
            for (const match of requires) {
                const specifier = match[1];
                expect(specifier.startsWith(".")).toBe(true);
                const resolved = path.resolve(path.dirname(file), specifier);
                const relative = path.relative(kernelRoot, resolved);
                expect(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))).toBe(true);
            }
        }
    });
});
