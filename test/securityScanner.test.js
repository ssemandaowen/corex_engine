"use strict";

/**
 * Characterization tests for utils/security.js (validateStrategyCode).
 *
 * Post-PR #16 behavior:
 *   BLOCKS: eval(), require('fs'), require('child_process'), the `process`
 *           global, dynamic require(variable), while(true), for(;;),
 *           new Function(), new Buffer(), module.<non-exports>, .__proto__,
 *           labeled statements, require('BaseStrategy') (legacy BaseStrategy removed).
 *   ALLOWS: require('corex-strategy-engine'), require('mathjs'),
 *           require('technicalindicators'), and path-relative requires
 *           ('./', '../').
 */

const { validateStrategyCode } = require("../utils/security");

describe("security scanner — post-legacy-deletion expectations", () => {

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

    // ── Post-#16 module expectations ─────────────────────────────────

    test("blocks require('BaseStrategy') post-legacy deletion", () => {
        const code = "const BaseStrategy = require('BaseStrategy');";
        expect(() => validateStrategyCode(code)).toThrow(/Unauthorized require/);
    });

    test("allows require('corex-strategy-engine')", () => {
        const code = "const { Strategy } = require('corex-strategy-engine');";
        expect(() => validateStrategyCode(code)).not.toThrow();
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
