"use strict";

const fs = require("fs");
const path = require("path");

describe("Dependency Direction Enforcement", () => {
    it("no file in packages/corex-strategy-engine/src requires @utils, @core, @config or another package's /src", () => {
        const srcDir = path.resolve(__dirname, "../src");

        function getJsFiles(dir) {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach((file) => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    results = results.concat(getJsFiles(fullPath));
                } else if (file.endsWith(".js")) {
                    results.push(fullPath);
                }
            });
            return results;
        }

        const files = getJsFiles(srcDir);
        const illegalPattern = /require\(['"](@(utils|core|config)|.*packages\/(?!corex-strategy-engine).*\/src)/;

        const violations = [];

        files.forEach((filePath) => {
            const content = fs.readFileSync(filePath, "utf8");
            const lines = content.split("\n");
            lines.forEach((line, index) => {
                if (illegalPattern.test(line)) {
                    violations.push(`${path.relative(srcDir, filePath)}:${index + 1}: ${line.trim()}`);
                }
            });
        });

        expect(violations).toEqual([]);
    });
});
