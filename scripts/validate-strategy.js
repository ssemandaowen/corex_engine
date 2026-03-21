#!/usr/bin/env node
"use strict";
require("module-alias/register");

/**
 * CoreX Strategy Validator CLI
 * 
 * Usage:
 *   node scripts/validate-strategy.js <strategy-file>
 *   node scripts/validate-strategy.js strategies/my_strategy.js
 *   node scripts/validate-strategy.js --all
 */

const path = require('path');
const fs = require('fs');
const StrategyValidator = require('../utils/strategy/StrategyValidator');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function printHeader() {
  console.log(colorize('='.repeat(70), 'cyan'));
  console.log(colorize('CoreX Strategy Validator', 'bright'));
  console.log(colorize('='.repeat(70), 'cyan'));
  console.log('');
}

function printResult(result) {
  const { summary, errors, warnings, info } = result;
  
  // Status
  const statusColor = summary.status === 'PASS' ? 'green' : 'red';
  console.log(colorize(`Status: ${summary.status}`, statusColor));
  console.log(colorize(`Grade: ${summary.grade}`, summary.grade.startsWith('A') ? 'green' : summary.grade.startsWith('B') ? 'yellow' : 'red'));
  console.log('');
  
  // Summary
  console.log(colorize('Summary:', 'bright'));
  console.log(`  Total Issues: ${summary.total}`);
  console.log(colorize(`  - Errors: ${summary.errors}`, summary.errors > 0 ? 'red' : 'green'));
  console.log(colorize(`  - Warnings: ${summary.warnings}`, summary.warnings > 0 ? 'yellow' : 'green'));
  console.log(colorize(`  - Info: ${summary.info}`, 'blue'));
  console.log('');
  
  // Errors
  if (errors.length > 0) {
    console.log(colorize('ERRORS:', 'red'));
    console.log(colorize('-'.repeat(70), 'red'));
    errors.forEach((err, i) => {
      console.log(colorize(`${i + 1}. [${err.code}] ${err.message}`, 'red'));
      if (err.fix) {
        console.log(colorize(`   Fix: ${err.fix}`, 'yellow'));
      }
      console.log('');
    });
  }
  
  // Warnings
  if (warnings.length > 0) {
    console.log(colorize('WARNINGS:', 'yellow'));
    console.log(colorize('-'.repeat(70), 'yellow'));
    warnings.forEach((warn, i) => {
      console.log(colorize(`${i + 1}. [${warn.code}] ${warn.message}`, 'yellow'));
      if (warn.fix) {
        console.log(colorize(`   Fix: ${warn.fix}`, 'cyan'));
      }
      console.log('');
    });
  }
  
  // Info
  if (info.length > 0 && process.argv.includes('--verbose')) {
    console.log(colorize('INFO:', 'blue'));
    console.log(colorize('-'.repeat(70), 'blue'));
    info.forEach((inf, i) => {
      console.log(colorize(`${i + 1}. [${inf.code}] ${inf.message}`, 'blue'));
    });
    console.log('');
  }
  
  console.log(colorize('='.repeat(70), 'cyan'));
}

async function validateStrategy(filePath) {
  try {
    console.log(colorize(`Validating: ${filePath}`, 'cyan'));
    console.log('');
    
    const result = await StrategyValidator.validateFile(filePath);
    printResult(result);
    
    return result.valid;
  } catch (error) {
    console.error(colorize(`Error: ${error.message}`, 'red'));
    return false;
  }
}

async function validateAllStrategies() {
  const strategiesDir = path.join(process.cwd(), 'strategies');
  
  if (!fs.existsSync(strategiesDir)) {
    console.error(colorize('Error: strategies directory not found', 'red'));
    process.exit(1);
  }
  
  const files = fs.readdirSync(strategiesDir)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'));
  
  console.log(colorize(`Found ${files.length} strategy file(s)`, 'cyan'));
  console.log('');
  
  const results = [];
  
  for (const file of files) {
    const filePath = path.join(strategiesDir, file);
    console.log(colorize(`\nValidating: ${file}`, 'bright'));
    console.log(colorize('-'.repeat(70), 'cyan'));
    
    const result = await StrategyValidator.validateFile(filePath);
    results.push({ file, result });
    
    const statusColor = result.valid ? 'green' : 'red';
    console.log(colorize(`Status: ${result.summary.status} | Grade: ${result.summary.grade}`, statusColor));
    console.log(colorize(`Errors: ${result.summary.errors} | Warnings: ${result.summary.warnings}`, 
      result.summary.errors > 0 ? 'red' : result.summary.warnings > 0 ? 'yellow' : 'green'));
  }
  
  // Summary
  console.log('');
  console.log(colorize('='.repeat(70), 'cyan'));
  console.log(colorize('VALIDATION SUMMARY', 'bright'));
  console.log(colorize('='.repeat(70), 'cyan'));
  
  const passed = results.filter(r => r.result.valid).length;
  const failed = results.length - passed;
  
  console.log(`Total Strategies: ${results.length}`);
  console.log(colorize(`Passed: ${passed}`, 'green'));
  console.log(colorize(`Failed: ${failed}`, failed > 0 ? 'red' : 'green'));
  console.log('');
  
  // Grade distribution
  const grades = {};
  results.forEach(r => {
    const grade = r.result.summary.grade;
    grades[grade] = (grades[grade] || 0) + 1;
  });
  
  console.log('Grade Distribution:');
  Object.keys(grades).sort().forEach(grade => {
    const color = grade.startsWith('A') ? 'green' : grade.startsWith('B') ? 'yellow' : 'red';
    console.log(colorize(`  ${grade}: ${grades[grade]}`, color));
  });
  
  console.log('');
  console.log(colorize('='.repeat(70), 'cyan'));
  
  return failed === 0;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  node scripts/validate-strategy.js <strategy-file>');
    console.log('  node scripts/validate-strategy.js strategies/my_strategy.js');
    console.log('  node scripts/validate-strategy.js --all');
    console.log('');
    console.log('Options:');
    console.log('  --all       Validate all strategies in strategies/ directory');
    console.log('  --verbose   Show detailed info messages');
    console.log('  --help, -h  Show this help message');
    process.exit(0);
  }
  
  printHeader();
  
  let success = false;
  
  if (args.includes('--all')) {
    success = await validateAllStrategies();
  } else {
    const filePath = path.resolve(args[0]);
    
    if (!fs.existsSync(filePath)) {
      console.error(colorize(`Error: File not found: ${filePath}`, 'red'));
      process.exit(1);
    }
    
    success = await validateStrategy(filePath);
  }
  
  process.exit(success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(colorize(`Fatal error: ${error.message}`, 'red'));
    process.exit(1);
  });
}

module.exports = { validateStrategy, validateAllStrategies };
