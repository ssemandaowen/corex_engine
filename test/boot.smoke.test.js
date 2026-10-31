"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

describe("Boot smoke test", () => {
    test("engine server module loads without MODULE_NOT_FOUND", () => {
        const script = 'require("module-alias/register"); process.env.PORT = "31999"; const server = require("./engine/server.js"); if (!server) process.exit(1); console.log("SERVER_LOADED_OK"); process.exit(0);';
        const res = spawnSync("node", ["-e", script], {
            cwd: path.resolve(__dirname, ".."),
            timeout: 25000,
            encoding: "utf8"
        });
        if (res.error) {
            console.error("Spawn error:", res.error);
        }
        if (res.stderr) {
            console.error("Stderr:", res.stderr);
        }
        expect(res.status).toBe(0);
        expect(res.stdout).toContain("SERVER_LOADED_OK");
    });
});
