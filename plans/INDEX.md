# CoreX Plans Index

## How to use plans/

1. **Read `plans/INDEX.md` first** to locate active architecture blueprints, audits, and task checklists.
2. **Read `plans/decisions.md` second** to understand locked architectural constraints and decision history before modifying code.

---

## Document Inventory

### Core Planning & Tracking

| File | Purpose | Date | Status |
|---|---|---|---|
| `plans/INDEX.md` | Master index and navigation guide for all planning and audit documents. | 2026-10-06 | CURRENT |
| `plans/decisions.md` | Chronological log of locked architectural decisions for CoreX engine and packages. | 2026-10-06 | CURRENT |
| `plans/to_do.md` | Active task tracking checklist for package extraction and engine modularization. | 2026-10-06 | CURRENT |
| `plans/KNOWN_ISSUES.md` | Records known failing test baselines and incomplete strategy engine tasks. | 2026-10-06 | CURRENT |
| `plans/STATUS.md` | Task and feature branch tracking for CoreX engineering PRs. | 2026-10-06 | CURRENT |
| `plans/target-architecture.md` | Target architecture map and roadmap for modular monolith package extractions. | 2026-10-06 | CURRENT |
| `plans/build-plan-slice0.md` | Build plan for Slice 0 core engine infrastructure. | 2026-10-06 | CURRENT |
| `plans/proposals/engine-remodel-plan.md` | Proposal for CoreX engine remodeling and structural reorganization. | 2026-10-06 | CURRENT |

### Package Extractions & Feature Plans

| File | Purpose | Date | Status |
|---|---|---|---|
| `plans/corex-accounts-implementation.md` | Implementation plan for extracting `corex-accounts` package and schema migrations. | 2026-10-06 | CURRENT |
| `plans/corex-portfolio-extraction.md` | Extraction plan for `corex-portfolio` trade history and analytics. | 2026-10-06 | SUPERSEDED by `plans/Audit/phase-2-analysis.md` |
| `plans/corex-auth-extraction-notes.md` | Discovery and verification notes for completed `corex-auth` extraction. | 2026-10-06 | CURRENT |
| `plans/socketx-plan.md` | Implementation plan for the Socket_X protocol layer in `corex-broker-contract`. | 2026-10-06 | SUPERSEDED by `packages/corex-gateway/` implementation |
| `plans/socket_x arch.txt` | Plain-text architectural topology diagram for the Socket_X protocol stack. | 2026-10-06 | CURRENT |
| `plans/socket_x_broker_model.svg` | SVG diagram illustrating Socket_X broker communication topology. | 2026-10-06 | CURRENT |

### Audit Reports & System Analyses (`plans/Audit/`)

| File | Purpose | Date | Status |
|---|---|---|---|
| `plans/Audit/architecture-audit.md` | Read-only architecture audit comparing actual codebase state vs decisions and plans. | 2026-10-06 | CURRENT |
| `plans/Audit/accounts-analysis.md` | Analysis of account identity, connection credential persistence, and session handling. | 2026-10-06 | CURRENT |
| `plans/Audit/corex-risk-plan.md` | Risk check logic consolidation plan and `SignalProcessingEngine` alignment. | 2026-10-06 | CURRENT |
| `plans/Audit/corex-strategy-engine-analysis.md` | Architecture, component inventory, and operational reference for `corex-strategy-engine`. | 2026-10-06 | CURRENT |
| `plans/Audit/corex-strategy-engine-audit.md` | Subsystem audit and performance analysis of strategy loader, compiler, and utilities. | 2026-10-06 | CURRENT |
| `plans/Audit/corex-strategy-engine-gap-analysis.md` | Gap analysis and hot-path allocation findings for `corex-strategy-engine`. | 2026-10-06 | CURRENT |
| `plans/Audit/corex-strategy-worker-pool-plan.md` | Scalability analysis and worker pool process isolation plan. | 2026-10-06 | CURRENT |
| `plans/Audit/indicator-dispatch-arity-fix.md` | Report and arity sweep fixing live indicator update arity mismatches in `IndicatorManager`. | 2026-10-06 | CURRENT |
| `plans/Audit/package-2-market-data.md` | Extraction source inventory, constraints, and decision log for `corex-market-data`. | 2026-10-06 | CURRENT |
| `plans/Audit/package-3-analysis.md` | Analysis of auth service extraction, secret key vault, and session revocation. | 2026-10-06 | CURRENT |
| `plans/Audit/package-ownership.md` | Package ownership audit and legacy duplicate file classification for `corex-strategy-engine`. | 2026-10-06 | CURRENT |
| `plans/Audit/phase-2-analysis.md` | Dependency and coupling map for strategy, execution, and portfolio package extractions. | 2026-10-06 | CURRENT |
| `plans/Audit/server-split-analysis.md` | Analysis evaluating Express server split vs pure-logic package extraction pattern. | 2026-10-06 | CURRENT |
| `plans/Audit/settings-config-audit.md` | Security audit of global and per-user settings, credential storage, and API secret masking. | 2026-10-06 | CURRENT |
| `plans/Audit/strategy-engine-wiring-baseline.md` | Baseline test counts recorded prior to wiring `corex-strategy-engine`. | 2026-10-06 | CURRENT |
| `plans/Audit/system-deep-dive.md` | System-wide reference document covering package profiles, engine services, and request paths. | 2026-10-06 | CURRENT |
| `plans/Audit/worker-pool-dual-registry-note.md` | Technical note documenting dual-registry active strategy tracking risks in dormant worker pool. | 2026-10-06 | CURRENT |
