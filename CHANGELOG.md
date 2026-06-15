# Changelog

## Unreleased

### Subagent orchestration — parallel fan-out + background + nested (`task_parallel` / `task_spawn` / `task_collect` / `task_status`)

The single one-shot `task` subagent grows into a real orchestration layer (`src/orchestrate.ts`):

- **Parallel fan-out** (`task_parallel`): run up to 16 subagents concurrently with a real concurrency cap and **per-item error isolation** (one failure never sinks the batch); results returned in order. For independent work — explore N modules, review N angles — instead of serial subagents.
- **Background / async** (`task_spawn` → `task_collect` / `task_status`): spawn a detached subagent, get an id immediately, keep working, and gather the result later in the same session. `task_collect` supports a timeout so the agent can poll instead of block; failures are captured as `error` state (never an unhandled rejection); `cancel` aborts via the subagent's `AbortSignal`.
- **Nested**: subagents may themselves `task` / `task_parallel` (bounded by the depth cap), so the main agent can decompose, then each branch can decompose again.
- **Parallel-safe context**: each subagent runs inside its own `AsyncLocalStorage.run()` scope, so concurrent/nested agents never bleed model/budget/depth into one another.
- Orchestration core is pure with an **injected runner** + injectable clock/id-gen, unit-tested with a fake runner (concurrency cap, error isolation, spawn/collect/cancel/timeout) — zero model calls in CI.

### Brain search — hybrid semantic search over the second brain (`sanook index` / `sanook search` / `sanook mcp serve`)

A Node-native search subsystem (`src/search/`) over the second-brain vault **plus** bi-temporal memory, past sessions, and skills — one ranked surface, zero new heavy deps.

- **Real BM25, zero-dependency floor**: a pure-TS inverted index (k1=1.2, b=0.75, genuine corpus-stat IDF, title field-boost) — no SQLite, no Bun, no native binary, works with no key and no network on any OS Node 22 runs on. Tokenization builds on the canonical `normalize()` and segments with `Intl.Segmenter` so **Thai** splits into real words.
- **Incremental indexer** (`sanook index`): mtime+size+sha256 manifest diff over the existing vault via `brainPath` — O(delta), unchanged files cost one `stat()`, deleted files are evicted precisely. No `ψ/`-style directory convention required. Folds in active memory facts (with an importance prior; quarantined/inbox facts excluded), recent sessions, and skills.
- **Optional BYOK semantic** (`--mode hybrid|semantic`): embeddings through your *existing* provider key (`@ai-sdk/{openai,mistral,google,…}` `embedMany`), stored as a compact Float32 sidecar, cosine in-process over a candidate set; fused with BM25 via **Reciprocal Rank Fusion** (scale-free, k=60). Lazy — absent without a key; a model change self-invalidates the cache. Degrades silently to BM25 on any embedding error.
- **MCP SERVER** (`sanook mcp serve`): sanook was MCP client-only; it now also *exposes* a stdio JSON-RPC server (`sanook_search` / `sanook_recall` / `sanook_remember` / `sanook_index` / `sanook_stats`), so Claude Desktop / Cursor / any MCP host can mount sanook's brain. Same zero-dep framing as the client; stdout stays protocol-clean.
- **`recall` upgraded**: the agent's recall tool now ranks by BM25 across all four corpora with snippets (was substring term-counting), and folds freshly-`remember`ed facts in on every call.
- Tests: BM25 ranking/IDF/no-posting-creep, heading chunker + frontmatter + wikilinks, RRF, incremental indexer (in-memory fs), cosine/serialize (fake vectors), engine modes + degradation, MCP server dispatch + a real piped-child round-trip (≈70 new).

### Competitive parity pass (table-stakes the OSS field now expects)

- **Remote MCP**: connect MCP servers over Streamable-HTTP (`{ "url": "https://…", "headers": {…} }`), not just stdio — half the hosted MCP ecosystem (GitHub/Slack/Postgres/…) is HTTP-only. `sanook mcp add <name> <url>` auto-detects remote.
- **Prompt caching**: the static system preamble (instructions + skills + brain + repo map) is sent as a cached Anthropic block, cutting cost/latency on multi-step turns; safely ignored by other providers.
- **OS sandbox for `run_bash`**: Seatbelt (macOS) / bubblewrap (Linux) confine shell **writes** to the workspace/brain/tmp — defense-in-depth over the regex blocklist. Reads + network unchanged; `SANOOK_NO_SANDBOX=1` to disable.
- **Checkpoint + `/rewind`**: a shadow-git snapshot before each turn; `/rewind` restores files **and** truncates the conversation (recoverable — it stashes the current state first).
- **Input ergonomics**: multiline (trailing `\` / Alt+Enter), `↑`/`↓` persisted prompt history, readline keys (Ctrl-A/E/U/K/W), and `@file` mentions that inline file contents.
- **Image / vision input**: `@image.png` attaches the image to vision-capable models (history keeps a lightweight placeholder, not the bytes).
- **Custom slash commands**: `.sanook/commands/<name>.md` prompt templates invoked as `/<name>` (project commands gated by trust).
- **Repo map**: a zero-dep, git-aware symbol map injected at session start so the agent selects files without blind grepping.
- **Reliability**: rate-limit/overload retry with exponential backoff, kept distinct from auth/billing failures (which fail fast); per-tool execution timeouts so a runaway read/grep can't hang the loop.
- **Minimal terminal-first TUI**: compact gradient banner, a real cursor + placeholder, and cleaner turn rendering.

### Fixes

- **Multi-turn history loss**: REPL/`--continue` now retain the full conversation (the user's earlier turns were being dropped — only assistant/tool messages were kept).
- **Budget cap was silent for ~all non-Anthropic models**: added approximate list prices for the other providers, a `pricing` override (`sanook config set pricing …` / `SANOOK_PRICING`), and a warning when `-b` is set for a model (or fallback model) with no pricing. Cost now carries over when the model falls back instead of resetting.
- MCP SSE parsing no longer aborts on a malformed earlier event; checkpoint restore pins the snapshot commit (correct even after an intervening commit) and removes files added after the snapshot.

- Tests: remote-MCP, sandbox, repo map, prompt-caching/system-preservation, rate-limit classification, tool timeout, checkpoint restore, cost merge, custom commands (≈200 total).

## 0.4.0 — second brain, GLM Coding Plan, Telegram, hardening

- **Second brain**: `sanook brain init` scaffolds a portable Obsidian "second-brain" workspace — full folder taxonomy (each with `_Index.md`), a central `Vault Structure Map.md`, seed memory files, and a portable AI operating constitution (`CLAUDE/GEMINI/AGENTS.md`). Research-backed rules: context-assembly (anti context-rot), intake quarantine + injection-scan, bi-temporal fact validity, provenance tracking, a verification-gated `Skills/` library, sleep-time consolidation. The agent now **loads the vault** into context, and `brain init` **auto-wires a filesystem MCP** to it. First-run wizard offers to create one (personalized).
- **GLM Coding Plan**: GLM routes through the Anthropic-compatible endpoint (`/api/anthropic`), so Coding Plan keys work; curated ids `glm-4.6 / glm-5.1 / glm-4.5-air`.
- **Telegram channel**: drive the agent from your phone (long-polling, fail-closed allowlist, private-only). Remote surface defaults to ask-mode (mutations denied) unless `TELEGRAM_ALLOW_WRITE=1`.
- **Auto-compaction**: token-aware sliding window keeps long sessions under the limit.
- **Interactive approval** (`ask` mode) + capability-based gating — any non-read-only tool (incl. MCP) is confirmed before running.
- **REPL resume** (`sanook -c`), **stdin piping** (`git diff | sanook "review"`), gateway multi-turn history, and `sanook config` / `sanook mcp` management commands.
- **Provider audit**: corrected stale model ids (OpenAI `gpt-5.3-codex`, DeepSeek `v4-flash/pro`, xAI `grok-4.3`).
- **Hardening**: budget cap now actually fires on the default fast model; write paths confined (no `~/.sanook` / shell-rc / ssh backdoors); MCP child processes get a minimal env (no secret leakage); provider errors surface a clean one-line message; versions read from `package.json`. Added tests for the BYOK/redaction core and budget cap.

## 0.3.0 — providers, memory, gateway, MCP, git

- **Providers**: data-driven registry, now 12 providers (added MiniMax, GLM, and OpenAI Codex via the official CLI). Per-provider model picker that fetches the live model list.
- **Memory**: auto-memory (`remember` / `recall`), session resume (`--continue`), and in-session REPL conversation history.
- **Gateway + cron**: `sanook serve` runs a loopback HTTP endpoint (OpenAI-compatible) plus a cron scheduler with natural-language scheduling, backed by a file-locked JSON task ledger.
- **Skills**: load `SKILL.md` files on demand; the agent can author its own with `create_skill`.
- **Subagents**: a `task` tool spawns a fresh-context sub-agent (read-only by default, depth-guarded).
- **Hooks**: PreToolUse / PostToolUse commands via `~/.sanook/hooks.json`.
- **Plan mode** (`--plan`): read-only exploration that produces a plan before acting.
- **MCP**: connect Model Context Protocol servers (stdio) via `~/.sanook/mcp.json`.
- **Git**: automatic git context in the prompt + `git_status` / `git_diff` / `git_log` / `git_commit` tools.
- Onboarding: welcome banner + first-run setup wizard.
- Hardened across several adversarial reviews — command injection, prompt injection, concurrency, and secret redaction.

## 0.1.0 — first usable release

A terminal AI coding agent, built from scratch in TypeScript. BYOK, works with any model.

- **Agent loop** on Vercel AI SDK 6 (`streamText` + `stopWhen` + `fullStream`), streamed output
- **Tools**: read / write / edit (multi-tier matcher) / list / glob / grep / bash, with a permission gate (denies destructive commands + protected paths)
- **Multi-provider BYOK**: Anthropic / OpenAI / Google / Ollama via one model spec; direct API key only (no OAuth/subscription reuse)
- **Cost meter** + budget cap (per-token, cache-aware)
- **Context memory**: hierarchical `SANOOK.md` loader (stops at project boundary) + tool-result compaction
- **Ink TUI** REPL with slash commands (`/model` `/cost` `/clear` `/compact` `/help`), plus headless `--json` mode for CI
- Eval harness (outcome-checked tasks) + CI matrix (mac/linux/windows × Node 22/24)
