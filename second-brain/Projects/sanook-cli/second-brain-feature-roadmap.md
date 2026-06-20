---
tags: [project, sanook-cli, second-brain, roadmap]
note_type: project-overview
created: 2026-06-18
updated: 2026-06-20
parent: "[[Projects/sanook-cli/_Index]]"
source::
  - src/bin.ts
  - src/brain.ts
  - src/memory.ts
  - src/knowledge.ts
  - src/mcp-server.ts
  - src/search/indexer.ts
  - src/brain-pack.ts
  - src/brain-new.ts
  - src/brain-repair.ts
  - src/brain-consolidate.ts
  - src/brain-metrics.ts
  - src/context-pack.ts
  - second-brain/SANOOK.md
related:: [[Research/2026-06-18-hermes-cli-second-brain-expansion-research]]
---

# Sanook CLI Second-Brain Feature Roadmap

> Implementation roadmap for doing the second-brain work inside Sanook CLI itself. This supersedes Hermes-specific next actions unless the task is explicitly about Hermes compatibility.

## Current Sanook Capabilities

- `sanook brain init [path]` scaffolds the vault, writes `SANOOK.md`, and stores `brainPath`.
- `wireBrainMcp()` adds a filesystem MCP server for the vault under `~/.sanook/mcp.json`.
- `buildBrainContext()` injects `Shared/AI-Context-Index.md`, `current-state.md`, Memory-Inbox candidates, and **auto-selected context packs** into agent context.
- `remember` writes to Sanook memory store and routes facts into vault Memory-Inbox.
- Headless sessions append a daily worklog into `Sessions/`.
- `sanook index` incrementally indexes vault + memory + sessions + skills.
- `sanook search` gives BM25 plus optional semantic/hybrid search over the unified index.
- `sanook mcp serve` exposes `sanook_search`, `sanook_recall`, `sanook_remember`, `sanook_index`, and `sanook_stats`.
- `sanook brain pack list|show`, `brain new`, `brain repair`, `brain consolidate`, and `brain metrics` operate on the configured vault from the CLI.

## Correct Direction

Do not make the next step `HERMES.md`. For Sanook CLI, the better work is:

1. Make Sanook able to inspect and repair its own second-brain.
2. Make Sanook able to assemble task-focused context from the vault.
3. Make Sanook able to run lightweight evals against the vault.
4. Keep the scaffold taxonomy stable until a command proves a new folder is necessary.

## P0 Features

### `sanook brain doctor`

Status: implemented.

Check the vault itself, not just installation:

- `brainPath` configured and exists.
- Hot files exist: `SANOOK.md`, `Shared/AI-Context-Index.md`, `Vault Structure Map.md`, `Shared/Operating-State/current-state.md`.
- Every markdown seed has purpose blockquote, `parent`, and `up::` where expected.
- `Vault Structure Map.md` mentions every `FOLDERS[]` entry.
- Search index exists and is fresh enough compared with vault mtimes.
- MCP wiring points to the configured vault.

### `sanook brain context [--task "..."]`

Status: implemented.

Show the exact context Sanook would inject or retrieve:

- Hot context sources and character counts.
- Optional task query that runs search and prints top vault/session/skill hits.
- Clear warning when context is stale, too large, or missing expected files.

### `sanook brain eval`

Status: implemented.

Turn `Evals/second-brain-benchmarks.md` into a runnable sanity check:

- Static cases: required files, routing links, memory policy, index presence.
- Retrieval cases: search for known benchmark phrases and verify expected files appear.
- Output pass/partial/fail with file evidence.

## P1 Features

### `sanook brain review`

Status: implemented.

Curator-style health review for the vault:

- Stale context packs.
- Duplicate or contradictory memory candidates.
- Sessions without index entries.
- Evals that have not been updated after framework changes.
- Markdown routing hygiene: purpose blockquote, `parent`, and `up::`.

### `sanook brain pack list|show`

Status: implemented (2026-06-20).

- List available packs with descriptions and index link status.
- Show pack sources, load order, done criteria, and expected use cases.
- Agent auto-selects a pack via `buildBrainContext({ taskQuery })` and per-turn retrieval when the query matches a pack.

### `sanook brain new <type>`

Status: implemented (2026-06-20).

Template-backed note creation:

- `session`, `bug`, `handoff`, `project`, `golden-case`, `checklist`.
- Reads destination `_Index.md`, fills frontmatter, and prevents wrong-folder drift.

### `sanook brain consolidate`

Status: implemented (2026-06-20).

Sleep-time consolidation runner based on `Runbooks/sleep-time-consolidation.md`:

- Inbox routing/dedup, stale → archive, retrieval eval, optional auto-memory merge.
- Dry-run by default; `--apply` / `--apply --archive` / `--memory` for writes.

## P2 Features

- `sanook brain export --for claude|gemini|codex|hermes` for adapter files only when explicitly needed.
- `sanook brain metrics` — **implemented (2026-06-20)**: counts, stale notes, index freshness, retrieval coverage.
- `sanook brain repair` — **implemented (2026-06-20)**: safe one-line fixes after `doctor`/`review` (purpose blockquote, `parent`, `up::`, pack links, scaffold folders).

## Folder Policy

No new root folder is needed yet.

Add folders only when a Sanook command needs stable output:

- `Evals/Benchmarks/` when `sanook brain eval` wants per-case files.
- `Acceptance/Golden-Cases/` when golden fixtures multiply.
- `Reviews/Vault-Health/` when `sanook brain review` starts writing scheduled reports. The current command is read-only, so no new folder is needed yet.

Avoid broad folders:

- No `Resources/`
- No `Notes/`
- No root `AI/`
- No root `Experiments/`

## First Implementation Slice

Completed on 2026-06-18:

1. Added `src/brain-doctor.ts` with pure check functions and CLI wiring.
2. Added `src/brain-context.ts` so Sanook can inspect the exact prompt context and task retrieval hits.
3. Added `src/brain-eval.ts` as a runnable benchmark sanity checker over `Evals/second-brain-benchmarks.md`.
4. Updated shell/REPL help and changelog.
5. Verified with targeted second-brain tests and typecheck.

## Second Implementation Slice

Completed on 2026-06-18:

1. Added `src/brain-review.ts` for curator-style vault review.
2. Wired `sanook brain review [--no-hygiene]` into CLI and help.
3. Updated generated `Shared/Context-Packs/_Index.md` to link bundled context packs.
4. Verified with review/scaffold/memory tests and typecheck.

## Third Implementation Slice

Completed on 2026-06-20 (release 0.5.3):

1. Added `src/brain-pack.ts` — `sanook brain pack list|show`.
2. Added `src/brain-new.ts` — `sanook brain new <type>`.
3. Added `src/brain-repair.ts` — `sanook brain repair [--dry-run]`.
4. Added `src/brain-consolidate.ts` — `sanook brain consolidate [--apply]`.
5. Added `src/brain-metrics.ts` — `sanook brain metrics`.
6. Added `src/context-pack.ts` — pack catalog + auto-select in `buildBrainContext()` / `buildTurnRetrieval()`.
7. Verified with targeted tests, full suite (1210 tests), and typecheck.

## Next Implementation Slice

Best next code slice:

1. Scheduled `sanook brain consolidate --apply` hook/cron integration for unattended sleep-time loops.
2. Richer pack auto-select (user-defined packs beyond bundled three) with `brain pack` discoverability in setup wizard.
3. `sanook brain export --for claude|gemini|codex|hermes` when adapter portability is explicitly needed.

## Project Portfolio (2026-06-20)

Status: **implemented** — multi-project vault via `Projects/<slug>/` + cwd auto-detect.

- Standard workspace files: `overview.md`, `current-state.md`, `context.md`, `repo.md` (`repo_path`, `verify`, `default_branch`)
- `sanook brain new project --title "..." --repo /path`
- `sanook brain projects list`
- Agent injects `<project_workspace>` when cwd matches `repo_path`
- `sanook brain context --project <slug>` for forced selection
- `brain init` skips copying bundled `Projects/<slug>/` (add projects explicitly)

up:: [[Projects/sanook-cli/_Index]]
