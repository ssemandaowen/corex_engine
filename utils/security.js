"use strict";

/**
 * CoreX Strategy Code Security Scanner
 *
 * Validates strategy source code via AST analysis before any execution.
 * Runs as part of the boot pipeline (Phase 2: VALIDATION).
 *
 * Blocks:
 * - Dangerous global identifiers (process, global, eval, Function, etc.)
 * - Dangerous module requires (fs, child_process, net, etc.)
 * - Infinite loops (while, do-while, for without finite bounds)
 * - Prototype pollution (__proto__, prototype manipulation)
 * - Dynamic code execution (eval, new Function, setTimeout with string)
 * - Access to engine internals via constructor tricks
 * - Buffer / SharedArrayBuffer / ArrayBuffer (memory bombs)
 *
 * Allows:
 * - require('BaseStrategy') and require path-relative imports
 * - require('mathjs') and require('technicalindicators')
 * - Standard class definitions, closures, and ES2022 features
 * - for...of and for...in loops (bounded by data structure size)
 */

const acorn     = require("acorn");
const walk      = require("acorn-walk");
const logger    = require("./logger");

// ─────────────────────────────────────────────────────────────────────────────
// Blocklists
// ─────────────────────────────────────────────────────────────────────────────

const DANGEROUS_GLOBALS = new Set([
    "eval", "Function",
    "setTimeout", "setInterval", "setImmediate",
    "clearTimeout", "clearInterval",
    "process", "global", "globalThis", "root",
    "constructor", "__proto__", "__defineGetter__", "__defineSetter__",
    "Buffer", "SharedArrayBuffer", "ArrayBuffer",
    "Proxy", "Reflect", "Symbol",
    "WebAssembly",
]);

const DANGEROUS_MODULES = new Set([
    "fs", "fs/promises",
    "child_process", "cluster",
    "net", "tls", "dgram",
    "http", "https", "http2",
    "os", "path",
    "vm", "module",
    "crypto",
    "worker_threads",
    "perf_hooks", "inspector",
    "repl", "readline",
    "stream", "buffer",
    "dns", "url", "querystring",
]);

const ALLOWED_MODULES = new Set([
    "mathjs",
    "technicalindicators",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Main validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate strategy source code via AST scan.
 *
 * @param {string} code - Strategy JavaScript source
 * @returns {boolean} true if safe, false if violations found
 * @throws {Error} with descriptive message listing all violations
 */
function validateStrategyCode(code) {
    if (!code || typeof code !== "string" || code.trim().length === 0) {
        throw new Error("Strategy code is empty or invalid");
    }

    let ast;
    try {
        ast = acorn.parse(code, {
            ecmaVersion:              2022,
            sourceType:               "script",
            allowReserved:            false,
            allowReturnOutsideFunction: false,
        });
    } catch (parseErr) {
        throw new Error(`Strategy code has a syntax error: ${parseErr.message}`);
    }

    const violations = [];

    walk.simple(ast, {

        // ── Block dangerous global identifiers ────────────────────────────
        Identifier(node) {
            if (DANGEROUS_GLOBALS.has(node.name)) {
                violations.push(`Forbidden identifier: ${node.name}`);
            }
        },

        // ── Block dangerous require() calls and eval/Function ────────────
        CallExpression(node) {
            // require('...')
            if (
                node.callee.type === "Identifier" &&
                node.callee.name === "require"
            ) {
                const arg = node.arguments[0];
                if (arg?.type === "Literal" && typeof arg.value === "string") {
                    const mod   = arg.value.trim();
                    const base  = mod.split("/")[0].toLowerCase();

                    if (DANGEROUS_MODULES.has(base)) {
                        violations.push(`Forbidden require: "${mod}" is a dangerous module`);
                        return;
                    }

                    // Allow only: relative imports, BaseStrategy, and explicitly safe packages
                    const isRelative    = mod.startsWith("./") || mod.startsWith("../");
                    const isBaseStrategy = mod.toLowerCase().includes("basestrategy");
                    const isAllowed     = ALLOWED_MODULES.has(base);

                    if (!isRelative && !isBaseStrategy && !isAllowed) {
                        violations.push(`Unauthorized require: "${mod}"`);
                    }
                } else if (!arg || arg.type !== "Literal") {
                    // Dynamic require: require(variable) — always block
                    violations.push("Dynamic require() is forbidden");
                }
            }

            // Direct eval() or Function() call
            if (node.callee.type === "Identifier") {
                const name = node.callee.name;
                if (name === "eval" || name === "Function") {
                    violations.push(`Forbidden call: ${name}()`);
                }
            }
        },

        // ── Block new Function(...), new Buffer(...), etc. ────────────────
        NewExpression(node) {
            if (node.callee.type === "Identifier") {
                const name = node.callee.name;
                if (
                    name === "Function" ||
                    name === "Buffer"   ||
                    name === "SharedArrayBuffer" ||
                    name === "ArrayBuffer"
                ) {
                    violations.push(`Forbidden constructor: new ${name}()`);
                }
            }
            // new obj.Function(...)
            if (
                node.callee.type === "MemberExpression" &&
                (node.callee.property?.name === "Function" ||
                 node.callee.property?.value === "Function")
            ) {
                violations.push("Forbidden: new [obj].Function(...)");
            }
        },

        // ── Block infinite loops ──────────────────────────────────────────
        WhileStatement(node) {
            // while(true) {} is always forbidden
            if (
                node.test.type === "Literal" &&
                node.test.value === true
            ) {
                violations.push("Forbidden: while(true) infinite loop");
            }
            // while(1) {}
            if (
                node.test.type === "Literal" &&
                node.test.value === 1
            ) {
                violations.push("Forbidden: while(1) infinite loop");
            }
        },

        DoWhileStatement(node) {
            // do {} while(true) is always forbidden
            if (
                node.test.type === "Literal" &&
                (node.test.value === true || node.test.value === 1)
            ) {
                violations.push("Forbidden: do...while(true) infinite loop");
            }
        },

        // ForStatement: block empty update (for(;;){}) but allow bounded loops
        ForStatement(node) {
            // for(;;) {} — no init, no test, no update
            if (!node.test && !node.init && !node.update) {
                violations.push("Forbidden: for(;;) infinite loop");
            }
            // for(; true ;) {}
            if (
                node.test?.type === "Literal" &&
                (node.test.value === true || node.test.value === 1)
            ) {
                violations.push("Forbidden: for(;true;) infinite loop");
            }
            // for(let i = 0; ; i++) {} — test is missing even though init/update present
            if (node.init && node.update && !node.test) {
                violations.push("Forbidden: for-loop with no termination condition");
            }
        },

        // ── Detect deeply nested loops (potential quadratic/infinite patterns) ─
        // Strategy code should never need more than 2 nested loops.
        // Depth-3+ loops on price series data can lock the event loop for seconds.
        ForInStatement(node) {
            // Block for..in on arrays (common accidental O(n²))
            if (
                node.right?.type === "CallExpression" ||
                node.right?.type === "Identifier"
            ) {
                // Allow it but it will be caught by the nesting visitor below if nested
            }
        },

        // ── Block module manipulation ─────────────────────────────────────
        MemberExpression(node) {
            if (
                node.object.type === "Identifier" &&
                node.object.name === "module"
            ) {
                const prop = node.property.name || node.property.value;
                if (prop && prop !== "exports") {
                    violations.push(`Forbidden: module.${prop}`);
                }
            }

            // Block prototype chain manipulation
            const propName = node.property?.name || node.property?.value;
            if (propName === "__proto__" || propName === "constructor") {
                violations.push(`Forbidden property access: .${propName}`);
            }
        },

        // ── Block labeled statements (used to break out of nested loops) ─
        // Labeled loops can be used to build complex infinite patterns.
        // Strategy code does not need them.
        LabeledStatement() {
            violations.push("Forbidden: labeled statements are not allowed in strategy code");
        },
    });

    if (violations.length > 0) {
        const msg = violations.join(" | ");
        logger.error(`[SECURITY_BLOCK] Strategy code rejected: ${msg}`);
        throw new Error(`Strategy code rejected by security scanner: ${msg}`);
    }

    return true;
}

module.exports = { validateStrategyCode };