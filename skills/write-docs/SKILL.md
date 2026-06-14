---
name: write-docs
description: Generates and updates project-facing documentation from the actual codebase — README, API reference, usage examples, and changelog entries — staying in sync with real code, signatures, and config. Use when docs are missing, stale, or after a feature/API change.
when_to_use: README/docs ขาดหรือ stale; หลังเพิ่ม feature/เปลี่ยน API; ต้องสร้าง changelog/usage example
---

## When to Use

- No README, or README's commands/flags no longer match the code.
- A feature, CLI command, function signature, or config key was added/renamed/removed.
- Need a changelog entry for a release, or runnable usage examples.

Do NOT use for inline code comments or design docs — this skill produces user-facing docs only.

## Steps

1. **Scan real structure first — never write from memory.**
   - Find entrypoint(s): `package.json` `bin`/`main`/`exports`, `pyproject.toml` `[project.scripts]`, `Cargo.toml` `[[bin]]`, or the file the README claims. Confirm it exists.
   - List runnable commands/scripts: `package.json` `scripts`, `Makefile` targets, declared CLI subcommands.
   - Enumerate public API: exported functions/classes/types (what's in `index`/`__init__`/`lib.rs`/public exports), not internal helpers.
   - Read config sources: env vars actually referenced in code (`grep` for `process.env.`, `os.environ`, `Deno.env`), config-file schema, default values. Use the real defaults from code, not guesses.

2. **Generate/update README** with sections, in this order:
   - **Install** — exact command from the real package manager + manifest (`npm i <name>`, `pip install <name>`, etc.). Verify the package name from the manifest, don't assume the repo name.
   - **Quickstart** — smallest runnable example that produces visible output.
   - **Usage** — each command/flag with real names and real defaults.
   - **Config** — a table: `Key | Type | Default | Description`, populated from code-confirmed values only.
   - Preserve existing hand-written prose; replace only the stale/code-derived parts. Don't nuke sections you can't regenerate.

3. **Write API reference from real signatures.** For each public symbol, pull the actual signature (params, types, return, throws) from source/type definitions. Match parameter names and order exactly. If a param has a default in code, show that default. Omit private/underscored/unexported symbols.

4. **Build changelog from commits.** `git log <last-tag>..HEAD --oneline`. Parse Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`...). Group under headings: **Added** (feat), **Fixed** (fix), **Changed** (refactor/perf), etc. Mark `BREAKING CHANGE:`/`!` commits prominently. Drop noise (merge commits, `chore: bump`, CI). Prepend a new version section above existing entries — never rewrite history.

5. **Verify every example runs.** Execute each quickstart/usage snippet (or `--help` for CLI flags) and confirm it succeeds. If a snippet can't be run in this environment, mark it clearly and base it strictly on a verified signature, not invention.

## Common Errors

- **Doc drifts from code** — writing a flag/param/default from the old README or assumption instead of re-reading source. Always re-scan; the README is a suspect, not a source of truth.
- **Wrong install name** — using the repo/folder name instead of the published package name in the manifest.
- **Hallucinated options** — listing flags/config keys that aren't referenced anywhere in code. If `grep` doesn't find it, it doesn't go in the docs.
- **Examples that error** — copy-paste snippets with stale imports, removed args, or wrong call order. Run them.
- **Leaking private data** — absolute home paths, machine names, personal/author identifiers, tokens, internal URLs in examples. Use generic placeholders (`/path/to/project`, `<your-api-key>`, `example.com`).
- **AI-look output** — emoji-spammed headers, rainbow callouts, padded marketing prose. Keep it plain, technical, scannable. No emoji unless the project already uses them.
- **Destroying prose** — overwriting hand-authored explanation/architecture notes while regenerating a code-derived section. Edit surgically.

## Verify

- Every command, flag, and config key in the docs maps to a real occurrence in the code (spot-check with `grep`).
- Install command uses the actual package name from the manifest.
- Each quickstart/usage example was executed and exited successfully (or is explicitly marked unrunnable + signature-verified).
- API signatures match source exactly (names, order, defaults, return type).
- Changelog groups commits by Conventional-Commit type, flags breaking changes, and adds a new section without altering past entries.
- No personal paths, identifiers, or secrets; no emoji/AI-look styling.
- Existing hand-written sections preserved.
