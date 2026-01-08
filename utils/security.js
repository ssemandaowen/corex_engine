const acorn = require('acorn');
const logger = require('./logger');

const FORBIDDEN_WORDS = ['process', 'require', 'eval', 'child_process', 'fs', 'module', 'global', 'env'];

/**
 * Static Analysis: Checks if the code string contains dangerous Node.js globals.
 */
function validateStrategyCode(codeString) {
    try {
        // Parse the code to check for syntax errors first
        acorn.parse(codeString, { ecmaVersion: 2022 });

        // Simple but effective check for forbidden keywords
        for (const word of FORBIDDEN_WORDS) {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            if (regex.test(codeString)) {
                throw new Error(`Security Violation: Forbidden keyword '${word}' detected.`);
            }
        }
        return true;
    } catch (err) {
        logger.error(`Security Check Failed: ${err.message}`);
        return false;
    }
}

module.exports = { validateStrategyCode };