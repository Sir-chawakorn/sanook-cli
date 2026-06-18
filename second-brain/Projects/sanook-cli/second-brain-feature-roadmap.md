---
tags: [project, sanook-cli, second-brain, roadmap]
note_type: project-overview
created: 2026-06-18
updated: 2026-06-18
parent: "[[Projects/sanook-cli/_Index]]"
source::
  - src/bin.ts
  - src/brain.ts
  - src/memory.ts
  - src/knowledge.ts
  - src/mcp-server.ts
  - src/search/indexer.ts
  - second-brain/SANOOK.md
related:: [[Research/2026-06-18-hermes-cli-second-brain-expansion-research]]
---

# Sanook CLI Second-Brain Feature Roadmap

> Implementation roadmap for doing the second-brain work inside Sanook CLI itself. This supersedes Hermes-specific next actions unless the task is explicitly about Hermes compatibility.

## Current Sanook Capabilities

- `sanook brain init [path]` scaffolds the vault, writes `SANOOK.md`, and stores `brainPath`.
- `wireBrainMcp()` adds a filesystem MCP server for the vault under `~/.sanook/mcp.json`.
- `buildBrainContext()` injects `Shared/AI-Context-Index.md`, `current-state.md`, and Memory-Inbox candidates into agent context.
- `remember` writes to Sanook memory store and routes facts into vault Memory-Inbox.
- Headless sessions append a daily worklog into `Sessions/`.
- `sanook index` incrementally indexes vault + memory + sessions + skills.
- `sanook search` gives BM25 plus optional semantic/hybrid search over the unified index.
- `sanook mcp serve` exposes `sanook_search`, `sanook_recall`, `sanook_remember`, `sanook_index`, and `sanook_stats`.

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

Make `Shared/Context-Packs/` first-class:

- List available packs with descriptions.
- Show pack sources and expected use cases.
- Eventually let the agent choose a pack before loading broader context.

### `sanook brain new <type>`

Template-backed note creation:

- `session`, `bug`, `handoff`, `project`, `golden-case`, `checklist`.
- Reads destination `_Index.md`, fills frontmatter, and prevents wrong-folder drift.

## P2 Features

- `sanook brain export --for claude|gemini|codex|hermes` for adapter files only when explicitly needed.
- `sanook brain metrics` for counts, stale notes, index freshness, and retrieval coverage.
- `sanook brain repair` for safe one-line fixes after `doctor` reports them.

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

## Next Implementation Slice

Best next code slice:

1. Add `sanook brain pack list|show` for `Shared/Context-Packs/`.
2. Add `sanook brain new <type>` once note creation templates need a CLI surface.
3. Add `sanook brain repair` for safe one-line fixes after `doctor`/`review` reports them.

up:: [[Projects/sanook-cli/_Index]]
