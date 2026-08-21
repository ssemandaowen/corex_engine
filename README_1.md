# CoreX Skill Collection for Kilo Code

A ready-to-extract set of Kilo Code v7 configuration files: 16 project-specific "skills" (rule
files), 3 custom review/planning agents, 2 workflow slash-commands, a portable `AGENTS.md`, and a
`kilo.jsonc` wiring it all together — built from CoreX's actual architecture, locked invariants,
and known bug history so Kilo Code (or any AGENTS.md-compatible agent) stops relearning the project
from scratch every session.

> Built against Kilo Code v7 (the OpenCode-based rebuild, GA April 2, 2026). If you're still on a
> pre-v7 install (`.kilocode/rules/` era), see **"If you're on legacy Kilo Code"** below.

## What's in the zip

```
corex-kilocode-skills/
├── README.md                                  ← this file
├── AGENTS.md                                  ← portable project baseline (also read by Copilot Coding Agent etc.)
├── kilo.jsonc                                  ← main config: wires up rules, agents, permissions
└── .kilo/
    ├── rules/                                  ← the 16 skills, numbered for load order
    │   ├── 01-project-overview.md
    │   ├── 02-architecture-invariants.md
    │   ├── 03-broker-plugin-pattern.md
    │   ├── 04-market-data-provider-abstraction.md
    │   ├── 05-strategy-dsl-engine.md
    │   ├── 06-risk-management-safety.md
    │   ├── 07-websocket-realtime-conventions.md
    │   ├── 08-state-persistence-and-recovery.md
    │   ├── 09-job-queue-worker-conventions.md
    │   ├── 10-security-credentials.md
    │   ├── 11-modularization-package-extraction.md
    │   ├── 12-git-workflow-package-extraction.md
    │   ├── 13-coding-standards-and-conventions.md
    │   ├── 14-testing-and-verification.md
    │   ├── 15-delegation-and-package-handoff-protocol.md
    │   └── 16-symbol-and-data-integrity.md
    ├── agents/                                 ← custom review/planning personas
    │   ├── risk-auditor.md          (read-only — audits risk/signal-path changes)
    │   ├── package-reviewer.md      (read-only — checks a finished package against the plan)
    │   └── refactor-planner.md      (plan-only — never edits, just proposes a plan)
    └── commands/                                ← reusable slash-commands
        ├── new-package.md            → /new-package <name>
        └── broker-check.md           → /broker-check <name>
```

## Install (2 minutes)

1. **Extract the zip at the root of your `corex_engine` repo** — the same level as `package.json`.
   On Windows PowerShell (matches your usual workflow):
   ```powershell
   Expand-Archive -Path corex-kilocode-skills.zip -DestinationPath . -Force
   ```
   On macOS/Linux:
   ```bash
   unzip corex-kilocode-skills.zip -d .
   ```
   This drops `AGENTS.md`, `kilo.jsonc`, and the `.kilo/` folder straight into your repo root.

2. **Check for conflicts.** If you already have a `kilo.jsonc` or `.kilo/` folder:
   - If you have **no existing rules/agents**, just let the extracted files land — nothing to merge.
   - If you have an **existing `kilo.jsonc`**, don't overwrite it blindly. Merge the `instructions`,
     `agents`, and `permission` blocks from the one in this zip into your existing file (see
     "Merging into an existing kilo.jsonc" below).
   - If you have an existing `.kilo/rules/` or `.kilo/agents/` with your own files, they can live
     side by side with these — just make sure your `instructions`/`agents` globs in `kilo.jsonc`
     pick up both (e.g. `.kilo/rules/*.md` already covers any file you add to that folder).

3. **Open the project in Kilo Code** (VS Code extension, JetBrains plugin, or CLI — they all read
   the same `kilo.jsonc`). Rules take effect on the **next new session** after the config file is
   saved — restart any currently-open Kilo session.

4. **Verify it loaded.** Start a fresh Kilo Code session in the repo and ask it directly:
   > "What are the non-negotiable architecture invariants for this project?"
   > "What's the current status of the market data provider refactor?"
   > "List three things you should never do in this codebase."

   If Kilo answers accurately from a cold start (server-decides-everything, WebSocket-only, no fake
   data, etc.), the skills are loaded correctly. If it can't, see Troubleshooting below.

That's it — nothing to `npm install`, no build step. These are plain config/markdown files Kilo
Code reads directly.

## Merging into an existing `kilo.jsonc`

If you already have a `kilo.jsonc`, add these three keys (or extend them if they already exist):

```jsonc
{
  "instructions": [
    ".kilo/rules/*.md"        // add this if not already present
    // ...keep any of your existing entries here too
  ],
  "agents": [
    ".kilo/agents/*.md"       // add this if not already present
  ],
  "permission": {
    // merge in the bash/read/edit/webfetch/external_directory values from the
    // kilo.jsonc in this zip — see that file directly for the exact block
  }
}
```

Rename the zip's `kilo.jsonc` to something like `kilo.jsonc.new` first if you want to compare
side-by-side before merging, then delete the `.new` file once merged.

## What each piece actually does

- **`AGENTS.md`** — loaded automatically by Kilo Code (and other AGENTS.md-aware tools) from the
  project root. High-level orientation: what CoreX is, the 5 locked invariants, current priorities,
  and working ground rules (propose-before-build, never fake data, package discipline).

- **`.kilo/rules/*.md`** — the detailed, topic-by-topic skills. Referenced by
  `"instructions": [".kilo/rules/*.md"]` in `kilo.jsonc`, so Kilo Code loads all 16 into its system
  prompt every session, in numeric order (foundational context first).

- **`.kilo/agents/*.md`** — switchable personas for specific review moments:
  - `risk-auditor` — read-only, for reviewing anything touching risk/signal/order logic.
  - `package-reviewer` — read-only, for checking a finished modularization package against plan.
  - `refactor-planner` — plan-only (can't edit or run bash), forces a short plan before any code.
  Switch to one with Kilo's agent picker, or ask the default `code` agent to "review this as the
  risk auditor would."

- **`.kilo/commands/*.md`** — typed as `/new-package <name>` or `/broker-check <name>` inside a Kilo
  session to run a pre-built checklist/workflow instead of re-explaining it each time.

- **`kilo.jsonc`** — the file Kilo Code actually reads at startup. Wires up the rules and agents
  above, and sets sane default permissions: git/test/build/lint commands run without prompting,
  destructive commands (`rm *`, `git reset --hard`) are blocked outright, and `.env*`/`secrets/**`
  are off-limits to automatic edits.

## Keeping it current

These skills reflect CoreX's state as of the plan/architecture decisions on record (broker
Contract/Factory pattern, risk-manager consolidation into `SignalProcessingEngine`, the market-data
abstraction refactor in progress, modularization plan). When a locked decision changes — a new
architectural invariant, a completed refactor, a newly extracted package — update the matching
numbered rule file rather than adding a new one; keep the numbering stable so load order doesn't
shift under files that reference each other.

## Troubleshooting

- **Kilo doesn't seem to know the rules exist** — confirm `kilo.jsonc` (or `.kilo/kilo.jsonc`) is at
  the exact path Kilo expects, and that you started a *new* session after saving it. If you have
  both a root `kilo.jsonc` and a `.kilo/kilo.jsonc`, the one inside `.kilo/` wins silently — pick one.
- **Only some rules seem to apply** — check the glob in `instructions` actually matches the folder
  name on disk (`.kilo/rules/`, not `.kilocode/rules/` — those are different, legacy vs. current).
- **Agent picker doesn't show the custom agents** — confirm `"agents": [".kilo/agents/*.md"]` is
  present in `kilo.jsonc` and that each agent file's YAML frontmatter is valid (a stray tab/space in
  the YAML block is the usual culprit).

## If you're on legacy Kilo Code (pre-v7, `.kilocode/rules/` era)

Kilo Code rebuilt its config system for v7 (GA April 2026): `.kilocode/rules/` + `.kilocodemodes`
were replaced by `kilo.jsonc` + `AGENTS.md` + `.kilo/agents/`. If your installed extension is still
pre-v7:
- Copy the contents of each file under `.kilo/rules/*.md` in this zip into a matching
  `.kilocode/rules/*.md` file — the markdown content itself needs no changes.
- The three files under `.kilo/agents/*.md` map to legacy custom modes (`.kilocodemodes`) — you'll
  need to recreate them as mode entries manually, using each file's frontmatter as your guide
  (`description` → mode description, `permission` → tool group equivalents).
- `AGENTS.md` and the `.kilo/commands/*.md` slash-commands have no legacy equivalent — treat
  `AGENTS.md`'s content as a `.kilocode/rules/00-overview.md` file instead.
- Strongly consider updating the extension — v7 is a large stability and feature jump, and this
  skill set is written natively for it.
