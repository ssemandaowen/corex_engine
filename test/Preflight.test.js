"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { runPreflight } = require("../engine/kernel/Preflight");

describe("engine/kernel/Preflight", () => {
    let tmpDir = null;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-test-"));
    });

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test("detects planted unresolved module-alias require specifier in scan directory", async () => {
        const fixtureDir = path.join(tmpDir, "fixture");
        fs.mkdirSync(fixtureDir, { recursive: true });

        // Plant a file requiring a non-existent alias specifier
        const plantedFile = path.join(fixtureDir, "badAlias.js");
        fs.writeFileSync(plantedFile, 'const x = require("@nonexistent/bogus-alias-package");', "utf8");

        const result = await runPreflight({
            config: { port: 39999, folders: { testData: tmpDir } },
            db: { configured: false },
            scanDirs: [fixtureDir]
        });

        expect(result.ok).toBe(false);

        const aliasCheck = result.checks.find(
            (c) => c.id === "check_alias_resolution" && c.status === "fail"
        );
        expect(aliasCheck).toBeDefined();
        expect(aliasCheck.what).toContain("@nonexistent/bogus-alias-package");
        expect(aliasCheck.fix).toContain("Add mapping");
    });

    test("passes alias resolution on clean directory without invalid aliases", async () => {
        const fixtureDir = path.join(tmpDir, "clean_fixture");
        fs.mkdirSync(fixtureDir, { recursive: true });

        const cleanFile = path.join(fixtureDir, "clean.js");
        fs.writeFileSync(cleanFile, 'const fs = require("fs");', "utf8");

        const result = await runPreflight({
            config: { port: 39998, folders: { testData: tmpDir } },
            db: { configured: false },
            scanDirs: [fixtureDir]
        });

        const aliasOk = result.checks.find(
            (c) => c.id === "check_alias_resolution" && c.status === "ok"
        );
        expect(aliasOk).toBeDefined();
    });

    test("warns when database is unconfigured and dbRequired=false", async () => {
        const result = await runPreflight({
            config: { port: 39997, dbRequired: false, folders: { testData: tmpDir } },
            db: { configured: false },
            scanDirs: []
        });

        const dbWarn = result.checks.find((c) => c.id === "check_database_ping");
        expect(dbWarn).toBeDefined();
        expect(dbWarn.status).toBe("warn");
        expect(dbWarn.what).toContain("unconfigured");
    });
});
