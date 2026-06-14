---
name: explore-codebase
description: Explores an unfamiliar codebase to map architecture, locate where a feature lives, and find reusable utilities before writing code — returning a concise summary of entrypoints, key modules, and conventions. Use when entering a new repo or before a change that spans files you don't know yet.
when_to_use: เข้า codebase ใหม่; ก่อนแก้งานที่กระจายหลายไฟล์ยังไม่รู้โครงสร้าง; หา util ที่ reuse ได้
---

## When to Use

Run this before writing or changing code in a repo you don't already have a mental model of. Concretely:

- First time touching this repo, or returning after major churn.
- The change spans files you can't name yet ("add auth to the API", "rename this config everywhere").
- You suspect a helper/util already exists and don't want to reinvent it.

Skip it when the change is fully described by a one-line diff in a file you already know (typo, log line, single rename). Exploring then is wasted context.

**Goal of the skill:** produce a short, reusable map — not to read the whole repo. Stop as soon as you can answer: where does the relevant code live, what conventions must I follow, what can I reuse.

## Steps

1. **Anchor on the manifest + docs first (cheap, high signal).**
   - Read `README*` and any `CONTRIBUTING`/`docs/` index.
   - Read the package/build manifest to learn language, deps, scripts, and entry: `package.json`, `pyproject.toml`/`setup.cfg`, `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle`, `Gemfile`, `composer.json`.
   - From `scripts`/targets, note the real **build / test / lint / start** commands. Do not guess them.

2. **Map structure shallowly — directories before files.**
   - List the top 1–2 levels of source dirs (e.g. `src/`, `app/`, `lib/`, `cmd/`, `internal/`, `pkg/`). Use a depth-limited listing, not a full recursive dump.
   - Find the entrypoint(s): `main`, `index`, `app`, `cmd/*/main.go`, `bin/*`, the `main`/`module` field in the manifest, or framework conventions (`pages/`, `app/`, `routes/`, `controllers/`).
   - Note where tests live (`test/`, `tests/`, `__tests__/`, `*_test.go`, `*.spec.*`) and config (`config/`, `*.config.*`, dotfiles, `.env.example`).

3. **Extract conventions (so your code matches the repo, not your defaults).**
   - Framework / runtime + version (from manifest + lockfile).
   - Test runner and how a single test runs (jest/vitest/pytest/go test/...).
   - Lint/format tool and config (`.eslintrc*`, `ruff`/`flake8`, `.prettierrc`, `.editorconfig`, `gofmt`).
   - Import/module style, path aliases (`tsconfig` `paths`, `jsconfig`), error-handling and logging patterns. Open 1–2 representative source files to confirm, don't infer from names alone.

4. **Locate the target feature + reusable utils with search, not browsing.**
   - Use ripgrep for the concept: `rg -n <symbol|route|string|error message>`. Search user-facing strings and route paths — they pin down the real implementation fast.
   - Find existing helpers before writing new ones: `rg -n "function|def|export (function|const)" <util-or-helpers-dir>`, or grep for likely names (`format`, `parse`, `client`, `validate`, `retry`).
   - Follow imports outward from the entrypoint or from the matched file to see how pieces wire together. Read only the files on that path.

5. **For a large/sprawling repo, delegate the wide read.**
   - Spin up a read-only Explore subagent with a narrow brief ("find where X is handled and what utils exist for Y; return file:line refs + summary"). It reads in its own context and returns a digest, keeping the main context lean.

6. **Return a tight summary — references, not contents.**
   Report only:
   - **Entrypoints:** file:line where execution/requests start.
   - **Where it lives:** the modules/files relevant to the task, with one-line roles.
   - **Conventions:** framework, test/lint/build commands, code-style notes to follow.
   - **Reuse:** existing utils/helpers to call instead of writing new ones (file:line).
   - **Gotchas:** anything surprising (codegen, monorepo boundaries, generated dirs, indirection).

## Common Errors / Gotchas

- **Reading everything until context fills up.** The most common failure. Cap your exploration; prefer `rg` + targeted reads over opening files to "get a feel". If you're reading the 10th file without a hypothesis, stop and search.
- **Vague summary nobody can act on** ("it's a typical web app"). Every claim must carry a `file:line` or exact command. If it isn't specific enough to start the change, it isn't done.
- **Grepping inside generated/vendored trees.** Exclude `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`, `target/`, `vendor/`, `.venv/`. Use `rg` (respects `.gitignore` by default) and don't override it with `-uu` unless needed.
- **Trusting folder names over reality** — a `utils/` may be dead, the real helpers elsewhere. Confirm by checking who imports it (`rg "from .*utils"` / `rg "import.*utils"`).
- **Guessing build/test commands** instead of reading them from the manifest/CI. Wrong command wastes a cycle; pull the exact one from `scripts`/CI config.
- **Monorepo blindness.** If you see `packages/`, `apps/`, `workspaces`, `pnpm-workspace.yaml`, `turbo.json`, or `go.work`, identify which package owns the task before mapping — the root manifest isn't the whole story.
- **Subagent brief too broad.** "Explain the codebase" returns a wall of text. Scope it to the task: one feature to locate, one question to answer.

## Verify

The exploration succeeded when all are true:

- You can name the **entrypoint** and the specific **files/modules** the upcoming change will touch, each with `file:line`.
- You have the **exact** build, test, and lint commands (copied from manifest/CI, not guessed).
- You listed any **reusable utils** relevant to the task, or confirmed none exist.
- A teammate could start the change from your summary **without re-reading the repo**.
- Your context is not bloated with full file contents you didn't need — references over dumps.

If you can't point to where the change goes, you haven't finished exploring — search more, or delegate a scoped Explore subagent.
