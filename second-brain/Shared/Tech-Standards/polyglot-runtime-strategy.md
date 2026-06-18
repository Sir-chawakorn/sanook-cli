---
tags: [tech-standard, sanook, polyglot, python, rust, typescript]
note_type: standard
created: 2026-06-19
updated: 2026-06-19
parent: "[[Shared/Tech-Standards/_Index]]"
---

# Polyglot Runtime Strategy

> Standard for using TypeScript, Python, and Rust in Sanook CLI without making optional language ecosystems mandatory for the npm install path.

## Principle

Sanook is npm-first. TypeScript/Node remains the default control plane because it owns packaging, the agent loop, TUI, gateway, MCP, skills, second-brain, and provider integration. Python and Rust are optional acceleration/specialization planes. Missing Python/Rust must degrade gracefully and must never break `npm install -g sanook-cli`.

## Language Roles

- TypeScript: orchestration, CLI UX, TUI, gateway, MCP, tools, memory, search baseline, configuration, and package distribution.
- Python: data/document/ML workflows, quick research scripts, CSV/JSON transforms, OCR/transcription glue, notebook-style analysis, and future optional skill packs.
- Rust: high-throughput parsers, native indexing/compression prototypes, single-binary helpers, sandbox/permission-sensitive utilities, and code that benefits from strict memory safety.

## Current Surface

- `sanook runtimes [--json]`: reports Python/Rust/uv/Cargo/LSP readiness and install hints.
- `run_python`: approval-gated no-shell Python snippet/file runner.
- `run_rust`: approval-gated no-shell single-file Rust snippet/file compiler+runner.
- `diagnostics`: already supports Python via Pyright and Rust via rust-analyzer when installed.

## Rules

- Do not add Python or Rust as mandatory npm install dependencies.
- Prefer no-shell process execution for built-in runtime tools.
- Treat Python/Rust execution as mutating because arbitrary code can write files or call network.
- Use Python for breadth and ecosystem leverage, not core CLI boot.
- Use Rust for narrow hot paths or native helpers only after a TypeScript implementation has measurable pain.
- Package Rust binaries only with a clear fallback path and platform matrix.
- Python optional packs should prefer `uv`/isolated environments if they grow beyond single scripts.

## Next Candidates

- Python: document ingestion/OCR pack, data profile command, local benchmark analysis, transcript cleanup.
- Rust: fast ignore-aware file scanner, compact tokenizer/count helper, native diff/parser experiment, archive/index compression helper.

up:: [[Shared/Tech-Standards/_Index]]

