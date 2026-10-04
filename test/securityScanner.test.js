"use strict";

/**
 * Characterization tests for utils/security.js (validateStrategyCode).
 *
 * These tests document the CURRENT behavior of the strategy-code security
 * scanner as observed on origin/main. They are characterization tests:
 * they pin existing behavior so that a later redesign of security.js can
 * be diffed against this baseline. Update them when security.js is
 * redesigned — do not treat the assertions below as the desired end state.
 *
 * Characterization tests; update when security.js is redesigned.
 *
 * Observed behavior on origin/main (dfb1b24):
 *   BLOCKS: eval(), require('fs'), require('child_process'), the `process`
 *           global, dynamic require(variable), while(true), for(;;),
 *           new Function(), new Buffer(), module.<non-exports>, .__proto__,
 *           labeled statements.
 *   ALLOWS: require('BaseStrategy') (legacy allowlist), require('mathjs'),
 *           require('technicalindicators'), and path-relative requires
 *           ('./', '../').
 *
 * NOTE: require('corex-strategy-engine') is currently BLOCKED on main
 * ("Unauthorized require") because it is not in ALLOWED_MODULES and is not
 * a relative path. The legacy-deletion branch (PR #16) adds
 * 'corex-strategy-engine' to ALLOWED_MODULES and removes the BaseStrategy
 * allowlist. That change is not on main yet; see
 * plans/Audit/j2-open-questions.md.
 */

const { validateStrategyCode } = require("../utils/security");

describe("security scanner — characterization (current main behavior)", () => {

    // ── Blocked: dangerous globals and calls ──────────────────────────

    test("blocks eval()", () => {
        const code = "const x = eval('1 + 1');";
        expect(() => validateStrategyCode(code)).toThrow(/eval/);
    });

    test("blocks the process global", () => {
        const code = "process.exit(0);";
        expect(() => validateStrategyCode(code)).toThrow(/process/);
    });

    test("blocks new Function()", () => {
        const code = "const f = new Function('a', 'return a');";
        expect(() => validateStrategyCode(code)).toThrow(/Function/);
    });

    test("blocks new Buffer()", () => {
        const code = "const b = new Buffer(1024);";
        expect(() => validateStrategyCode(code)).toThrow(/Buffer/);
    });

    // ── Blocked: dangerous module requires ────────────────────────────

    test("blocks require('fs')", () => {
        const code = "const fs = require('fs');";
        expect(() => validateStrategyCode(code)).toThrow(/dangerous module/);
    });

    test("blocks require('child_process')", () => {
        const code = "const cp = require('child_process');";
        expect(() => validateStrategyCode(code)).toThrow(/dangerous module/);
    });

    test("blocks require('net')", () => {
        const code = "const net = require('net');";
        expect(() => validateStrategyCode(code)).toThrow(/dangerous module/);
    });

    test("blocks require('crypto')", () => {
        const code = "const crypto = require('crypto');";
        expect(() => validateStrategyCode(code)).toThrow(/dangerous module/);
    });

    // ── Blocked: dynamic require ──────────────────────────────────────

    test("blocks dynamic require(variable)", () => {
        const code = "const m = require(moduleName);";
        expect(() => validateStrategyCode(code)).toThrow(/Dynamic require/);
    });

    // ── Blocked: infinite loops ───────────────────────────────────────

    test("blocks while(true)", () => {
        const code = "while (true) { }";
        expect(() => validateStrategyCode(code)).toThrow(/infinite loop/);
    });

    test("blocks for(;;)", () => {
        const code = "for (;;) { }";
        expect(() => validateStrategyCode(code)).toThrow(/infinite loop/);
    });

    test("blocks do...while(true)", () => {
        const code = "do { } while (true);";
        expect(() => validateStrategyCode(code)).toThrow(/infinite loop/);
    });

    // ── Blocked: prototype pollution and module manipulation ──────────

    test("blocks .__proto__ access", () => {
        const code = "const p = obj.__proto__;";
        expect(() => validateStrategyCode(code)).toThrow(/__proto__/);
    });

    test("blocks module.<non-exports>", () => {
        const code = "const m = module.require('x');";
        expect(() => validateStrategyCode(code)).toThrow(/module\./);
    });

    test("blocks labeled statements", () => {
        const code = "outer: for (let i = 0; i < 10; i++) { break outer; }";
        expect(() => validateStrategyCode(code)).toThrow(/labeled/);
    });

    // ── Allowed: safe packages and relative imports ───────────────────

    test("allows require('mathjs')", () => {
        const code = "const math = require('mathjs');";
        expect(() => validateStrategyCode(code)).not.toThrow();
    });

    test("allows require('technicalindicators')", () => {
        const code = "const ti = require('technicalindicators');";
        expect(() => validateStrategyCode(code)).not.toThrow();
    });

    test("allows a path-relative require ('./')", () => {
        const code = "const helper = require('./helper');";
        expect(() => validateStrategyCode(code)).not.toThrow();
    });

    test("allows a path-relative require ('../')", () => {
        const code = "const helper = require('../lib/helper');";
        expect(() => validateStrategyCode(code)).not.toThrow();
    });

    // ── Legacy allowlist (characterization of current main) ───────────

    test("allows require('BaseStrategy') — legacy allowlist on main", () => {
        // Current main behavior: BaseStrategy is allowed via the
        // isBaseStrategy substring check. PR #16 removes this allowlist.
        const code = "const BaseStrategy = require('BaseStrategy');";
        expect(() => validateStrategyCode(code)).not.toThrow();
    });

    test("blocks require('corex-strategy-engine') on main — not yet allowlisted", () => {
        // Current main behavior: corex-strategy-engine is NOT in
        // ALLOWED_MODULES and is not relative, so it is rejected.
        // PR #16 adds it to ALLOWED_MODULES. Characterized here so the
        // change is visible when PR #16 lands.
        const code = "const { Strategy } = require('corex-strategy-engine');";
        expect(() => validateStrategyCode(code)).toThrow(/Unauthorized require/);
    });

    // ── Input validation ──────────────────────────────────────────────

    test("rejects empty code", () => {
        expect(() => validateStrategyCode("")).toThrow(/empty or invalid/);
    });

    test("rejects non-string input", () => {
        expect(() => validateStrategyCode(null)).toThrow(/empty or invalid/);
    });

    test("rejects code with a syntax error", () => {
        const code = "class { ";
        expect(() => validateStrategyCode(code)).toThrow(/syntax error/);
    });

    // ── Allowed: ordinary strategy shape ──────────────────────────────

    test("allows a plain class with a bounded for loop", () => {
        const code = [
            "class MyStrategy {",
            "  next(bar) {",
            "    let sum = 0;",
            "    for (let i = 0; i < bar.close.length; i++) {",
            "      sum += bar.close[i];",
            "    }",
            "    return sum;",
            "  }",
            "}",
            "module.exports = MyStrategy;",
        ].join("\n");
        expect(() => validateStrategyCode(code)).not.toThrow();
    });
});
