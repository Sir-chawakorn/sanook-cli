# Changelog

## 0.1.0 — first usable release

A terminal AI coding agent, built from scratch in TypeScript. BYOK, works with any model.

- **Agent loop** on Vercel AI SDK 6 (`streamText` + `stopWhen` + `fullStream`), streamed output
- **Tools**: read / write / edit (multi-tier matcher) / list / glob / grep / bash, with a permission gate (denies destructive commands + protected paths)
- **Multi-provider BYOK**: Anthropic / OpenAI / Google / Ollama via one model spec; direct API key only (no OAuth/subscription reuse)
- **Cost meter** + budget cap (per-token, cache-aware)
- **Context memory**: hierarchical `SANOOK.md` loader (stops at project boundary) + tool-result compaction
- **Ink TUI** REPL with slash commands (`/model` `/cost` `/clear` `/compact` `/help`), plus headless `--json` mode for CI
- Eval harness (outcome-checked tasks) + CI matrix (mac/linux/windows × Node 22/24)
