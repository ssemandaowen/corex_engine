"use strict";

/**
 * Boot smoke test — Stage 0 prerequisite check for the legacy-deletion task.
 *
 * Loads engine/server.js (no listen, no DB connect, no routes invoked).
 * If any module in the boot chain has an unresolved alias, Node throws
 * MODULE_NOT_FOUND and the test fails.
 *
 * Does NOT open a database connection and does NOT start the HTTP server.
 */

describe("Boot module resolution", () => {
    it("engine/server requires without MODULE_NOT_FOUND", () => {
        require("module-alias/register");

        // require() of engine/server triggers dotenv + all top-level imports.
        // It must not throw an uncaught MODULE_NOT_FOUND at require time.
        expect(() => require("../engine/server")).not.toThrow(/MODULE_NOT_FOUND/);
    });

    it("engine/index.js requires without MODULE_NOT_FOUND", () => {
        require("module-alias/register");
        expect(() => require("../engine/index")).not.toThrow(/MODULE_NOT_FOUND/);
    });
});
