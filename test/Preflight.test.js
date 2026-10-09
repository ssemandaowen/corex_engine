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

    describe("comment-safe scanning and line numbers", () => {
        const scan = async (name, source) => {
            const dir = path.join(tmpDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, "file.js"), source, "utf8");
            return runPreflight({
                config: { port: 39998, folders: { testData: tmpDir } },
                db: { configured: false },
                scanDirs: [dir]
            });
        };
        const aliasFails = (r) => r.checks.filter((c) => c.id === "check_alias_resolution" && c.status === "fail");

        test("ignores require() written inside comments", async () => {
            const r = await scan("comments", [
                "/**",
                ' *   const f = require("@nonexistent/in-block-comment");',
                " */",
                '// const g = require("@nonexistent/in-line-comment");',
                "module.exports = 1;"
            ].join("\n"));
            expect(aliasFails(r)).toHaveLength(0);
        });

        test("still detects a real require after a string containing //", async () => {
            const r = await scan("strings", [
                'const url = "http://example.com/a";',
                'const x = require("@nonexistent/after-string");'
            ].join("\n"));
            const fails = aliasFails(r);
            expect(fails).toHaveLength(1);
            expect(fails[0].where).toMatch(/file\.js:2$/);
        });

        test("reports the line number of an unresolved alias", async () => {
            const r = await scan("lines", "\n\n\nconst x = require(\"@nonexistent/line4\");");
            const fails = aliasFails(r);
            expect(fails).toHaveLength(1);
            expect(fails[0].where).toMatch(/file\.js:4$/);
        });
    });

    test("repository source has no unresolved alias requires (real Node resolution)", () => {
        // Jest's own resolver ignores module-alias, so run the doctor in plain Node,
        // the same way `npm run doctor` and `npm start` resolve modules.
        const { spawnSync } = require("child_process");
        const doctor = path.join(__dirname, "..", "scripts", "doctor.js");
        const r = spawnSync(process.execPath, [doctor], {
            cwd: path.join(__dirname, ".."),
            encoding: "utf8",
            timeout: 60000,
            env: { ...process.env, PORT: "0" }
        });
        const out = `${r.stdout || ""}${r.stderr || ""}`;
        const unresolved = out.split("\n").filter((l) => l.includes("Unresolved alias specifier"));
        expect(unresolved).toEqual([]);
        expect(out).toMatch(/All module alias require specifiers resolve successfully/);
    });
});
