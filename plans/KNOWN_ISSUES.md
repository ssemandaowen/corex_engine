# CoreX — Known Issues & Accepted Test Baselines

This document records known failing tests that are deliberately left as an acknowledged baseline per development rules.

## 1. Security Scanner Test Syntax Error (`test/round7.comprehensive.test.js`)

- **Affected Tests:**
  - `security.js — loop guards › eval is blocked`
  - `security.js — loop guards › require('fs') is blocked`
  - `security.js — loop guards › process access is blocked`
- **Root Cause:** The test helper function `wrap` in `test/round7.comprehensive.test.js` embeds strategy code snippets into a class method body without a trailing semicolon or newline separating expression statements from `return null;` (e.g. `next(bar) { eval('1+1') return null; }`). This causes Acorn to throw a syntax error (`Unexpected token`) during AST parsing in `validateStrategyCode()` before security blocklist assertions can evaluate.
- **Classification:** Category (b) — tests relevant security scanner rules, but broken by a test setup bug. Per project instructions, this is flagged here and left unfixed for now.
