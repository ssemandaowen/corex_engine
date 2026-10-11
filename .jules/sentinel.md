# Sentinel Security Journal

## 2026-10-11 - Dynamic Import Expression Security Scanner Bypass
**Vulnerability:** Dynamic `import(...)` expressions (`ImportExpression` in Acorn AST) were not inspected by `utils/security.js`, allowing strategy code to bypass `require()` module blocklists and import built-in Node modules like `fs`.
**Learning:** Checking only `CallExpression` for `require` allowed ES2020 dynamic import expressions (`import("fs")`) to slip through the AST walker.
**Prevention:** Explicitly handle `ImportExpression` nodes in AST security walkers alongside `CallExpression` `require` checks.
