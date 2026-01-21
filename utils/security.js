"use strict";

const acorn = require('acorn');
const walk = require('acorn-walk');
const logger = require('./logger');

// ────────────────────────────────────────────────
//  Really dangerous things — block almost always
// ────────────────────────────────────────────────
const DANGEROUS_GLOBALS = new Set([
    'eval', 'Function', 'setTimeout', 'setInterval', 'setImmediate',
    'process', 'global', 'globalThis', 'root', 'this', 'arguments',
    'constructor', '__proto__', 'prototype'
]);

const DANGEROUS_MODULES = new Set([
    'fs', 'child_process', 'net', 'tls', 'http', 'https', 'http2',
    'crypto', 'os', 'vm', 'worker_threads', 'perf_hooks',
    'inspector', 'module', 'cluster', 'repl', 'readline'
]);

function validateStrategyCode(code) {
    try {
        const ast = acorn.parse(code, {
            ecmaVersion: 2022,
            sourceType: 'script',
            allowReserved: false,
            allowReturnOutsideFunction: false
        });

        let violations = [];

        walk.simple(ast, {
            // 1. Block dangerous global identifiers
            Identifier(node) {
                if (DANGEROUS_GLOBALS.has(node.name)) {
                    violations.push(`Forbidden global: ${node.name}`);
                }
            },

            // 2. Block require of dangerous modules
            CallExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
                    const arg = node.arguments[0];
                    if (arg?.type === 'Literal' && typeof arg.value === 'string') {
                        const mod = arg.value.toLowerCase().trim();

                        // Very strict — only allow known safe internal paths
                        const isAllowed =
                            mod.includes('basestrategy') ||
                            mod.startsWith('./') ||
                            mod.startsWith('../') ||
                            mod === 'mathjs' ||
                            mod === 'technicalindicators';

                        if (!isAllowed) {
                            violations.push(`Unauthorized require: "${arg.value}"`);
                        }

                        // Explicitly block known bad modules even if path tricks used
                        if (DANGEROUS_MODULES.has(mod.split('/')[0])) {
                            violations.push(`Dangerous module require: ${arg.value}`);
                        }
                    }
                }

                // Block new Function / eval-like patterns
                if (node.callee.type === 'Identifier') {
                    const name = node.callee.name;
                    if (name === 'eval' || name === 'Function') {
                        violations.push(`Forbidden constructor: ${name}`);
                    }
                }
            },

            // 3. Block module.exports = ... tricks or other module access
            MemberExpression(node) {
                if (node.object.type === 'Identifier' && node.object.name === 'module') {
                    const prop = node.property.name || node.property.value;
                    if (prop && prop !== 'exports') {
                        violations.push(`Forbidden module.${prop}`);
                    }
                }
            },

            // 4. Catch indirect eval / Function via MemberExpression
            NewExpression(node) {
                if (node.callee.type === 'MemberExpression' &&
                    node.callee.object.name === 'Function') {
                    violations.push('Forbidden: new Function(...)');
                }
            }
        });

        if (violations.length > 0) {
            const msg = violations.join(' | ');
            logger.error(`[SECURITY_BLOCK] ${msg}`);
            throw new Error(`Code rejected: ${msg}`);
        }

        return true;

    } catch (err) {
        logger.error(`[STRATEGY_SECURITY_ERROR] ${err.message}`);
        return false;
    }
}

module.exports = { validateStrategyCode };