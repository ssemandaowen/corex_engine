# Historical P2 — Provider Discoverability and Dynamic Configuration

> **Tracking correction (2026-11-22):** This task used the P2 label already assigned to strategy-contract retirement. Its original scope was superseded by the bounded B11 provider task. Retained for historical context, not as an active task.

**Status:** SUPERSEDED — implementation scope: `plans/tasks/PROV-01-provider-discoverability-and-runtime-config.md`  
**Priority:** P2 (architectural assessment → bounded implementation)  
**Source:** Provider Integration Verification findings, `plans/reports/PROVIDER_INTEGRATION_VERIFICATION_RESULTS.md` §Phase 6  
**Repository:** `C:\Users\SBUM\Desktop\corex`  
**Branch:** Do not create a new branch unless required; preserve all existing uncommitted work

## Problem

Three provider implementations exist (Twelve Data, Yahoo Finance, File), but only Twelve Data is registered as active. OANDA is an unconsumed dependency. Provider selection is hardcoded at package import (`index.js` auto-registers Twelve Data). Configuration refresh reaches the legacy singleton but not necessarily a re-instantiated provider. Symbol metadata is not provider-specific and inspectable beyond the normalizer rules.

## Scope (in)

- Architectural assessment of provider registration, activation, credential ownership, configuration refresh, and provider selection
- Document gaps: registry enumeration, exported-but-unregistered providers, config-driven vs hardcoded selection, credential precedence, refresh-to-active-provider, health/status surfacing, symbol metadata inspectability
- Recommend bounded implementation items (do not implement a generic plugin framework)

## Scope (out)

- Do NOT create a generic plugin framework
- Do NOT change the single-active-provider constraint without Owen's approval
- Do NOT modify provider registration in production code without a separate approved task
- Do NOT stage, commit, push, or merge

## Acceptance criteria

1. Documented assessment of provider discoverability gaps
2. Prioritized, bounded implementation recommendations
3. Each recommendation scoped to a separate task with acceptance criteria

## Evidence required

- Assessment report (can be section in `plans/reports/` or a separate design doc)
