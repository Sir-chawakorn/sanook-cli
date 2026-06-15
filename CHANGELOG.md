# Changelog

## Unreleased

### Install UX — `sanook doctor` + post-install guidance (the "`sanook` is not recognized" fix)

The #1 first-run snag is `npm i sanook-cli` **without `-g`** → a local install that never lands on PATH, so typing `sanook` fails. Two root-cause fixes:

- **`sanook doctor`** — a new diagnose-and-fix command. Checks Node version, the npm global-bin dir, whether the `sanook` shim is installed there, whether that dir is on PATH, and whether a local install exists in the cwd — then prints the **exact, OS-safe remedy**. On Windows it emits the *safe* user-PATH PowerShell one-liner (`[Environment]::SetEnvironmentVariable(... 'User')`), deliberately **not** `setx %PATH%` (which truncates PATH at 1024 chars and duplicates the system PATH — a known corruption footgun). Runnable as `npx sanook doctor` even before a global install.
- **post-install hint** — right after `npm i`, the installer now prints the working command: local install → `npx sanook` or `npm i -g sanook-cli`; global install → "ready, type `sanook`". Never fails the install (always exits 0); stays quiet during repo-dev self-installs and CI.

### Cross-platform hardening — Windows / macOS / Linux

Audited the whole codebase (process spawning, paths, external deps, terminal) and fixed the real Windows breakers:

- **Child-process spawning on Windows**: `npx`/`npm`/`codex` are `.cmd` shims, so `spawn('npx', …)` failed with ENOENT — breaking **MCP servers** (incl. the second-brain filesystem MCP), **`sanook update`**, and the **Codex provider**. Now spawned with `shell` on `win32`. (`hooks` already used a shell; git/LSP already resolve correctly.)
- **`grep` works without ripgrep**: if `rg` isn't installed (common on a fresh Windows box) the grep tool now falls back to a pure-Node search (recursive walk, default-ignore set, binary/large-file skip, CRLF-aware) instead of a cryptic `spawn rg ENOENT`. Verified end-to-end with `rg` removed from PATH.
- **The agent knows its OS**: the system prompt now states the platform + shell, so on Windows it generates `dir`/`type`/`findstr` (or prefers the cross-platform read/list/glob/grep tools) instead of `ls`/`cat`/`grep` into cmd.exe.
- **CRLF-safe vault indexing**: the markdown chunker normalizes `\r\n` so frontmatter/sections parse identically on Windows.
- **Terminal**: respects `NO_COLOR` and auto-disables ANSI when output is piped/redirected (no `[2m` garbage on legacy cmd); `FORCE_COLOR` overrides.
- **Clear "not installed" errors** for `git` (and ripgrep) instead of raw `spawn … ENOENT`.
- (Prior turn) Node-version guard (≥ 22) with a clear message; install docs clarified for `-g` / `npx` / Windows `setx`.

### Skills — 16 more real-work skills, author+verify reviewed (130 → 146)

A second, larger batch filling concrete gaps in distributed-systems correctness, testing rigor, frontend, security, and AI — each one **independently verified** (a separate reviewer agent read the written file and judged frontmatter validity, structure, cross-reference resolution, technical accuracy, and *actionability* — would an agent actually be able to follow it; all 16 passed):

- **Backend/distributed**: `design-api-pagination` (cursor/keyset, stable ordering, Relay connections), `distributed-locks-leases` (Redlock caveats + fencing tokens, leader election), `design-state-machine` (explicit FSM/statecharts vs boolean-flag soup), `schema-evolution-compatibility` (backward/forward compat, reserve-don't-reuse, expand-then-contract).
- **Testing**: `debug-flaky-tests` (taxonomy + root-cause fixes, not retry-masking), `test-data-factories` (factories over fixtures, faker, deterministic seeds), `property-based-testing` (invariants + shrinking), `contract-testing` (consumer-driven Pact + can-i-deploy), `visual-regression-testing` (deterministic screenshots).
- **Frontend**: `build-data-table` (virtualized sortable/filterable grids), `optimize-react-rerenders` (profiler-driven memoization).
- **Security**: `configure-security-headers-csp` (strict CSP with nonces, HSTS, CORS done right), `encrypt-sensitive-data` (KMS envelope encryption, AEAD, key rotation).
- **AI/LLM**: `build-vector-search` (ANN indexes, hybrid + RRF, eval), `structured-output-llm` (json_schema/tool-calling + validate-and-repair).
- **DevEx**: `debug-ci-pipeline-failure` (reproduce locally, classify, fix root cause).

All load cleanly (catalog now 146), cross-reference only real sibling skills, and follow the When-to-Use + NOT-this-skill + dense Steps structure.

### Skills — 7 high-value additions, closing reliability/integration gaps (123 → 130)

New bundled skills filling conspicuous holes in the catalog, authored to the existing dense, cross-referenced bar:

- **resilience-timeouts-retries** — timeouts on everything, deadline propagation, retry-only-if-idempotent, exponential backoff + full jitter, circuit breakers, bulkheads, load-shedding (the general reliability primitive the catalog was missing alongside `rate-limiting`).
- **idempotency-keys** — make writes safe to repeat: idempotency by design (PUT/upsert/conditional) vs by key (the `Idempotency-Key` header pattern, dedup table, 409/422, outbox), consumer-side dedup, "effectively-once".
- **integrate-oauth-oidc** — "Log in with Google/GitHub/…": Authorization Code + PKCE, state/nonce, server-side token exchange, full ID-token validation, safe `email_verified` account linking, refresh rotation, native system-browser-only. Complements `auth-jwt-session` (which owns *your* session).
- **send-transactional-email** — the deliverability half: SPF/DKIM/DMARC alignment, provider-not-cold-MTA, transactional/marketing stream isolation, bounce/complaint → suppression, idempotent sends, sandbox testing.
- **design-multi-tenancy** — tenant isolation models (shared+RLS / schema / DB-per-tenant), the #1 cross-tenant-leak bug + defense-in-depth (app scoping + Postgres RLS), tenant context propagation, per-tenant migrations/export/delete.
- **build-cli-tool** — argument parsing, exit codes, stdout=data/stderr=logs, TTY/NO_COLOR, config precedence (flags>env>file), no-secrets-in-flags, dry-run — the CLI/UX design counterpart to `shell-script-robust`.
- **deliver-webhooks** — the *producer* side: HMAC signing + rotation, replay tolerance, at-least-once retries + dead-letter + replay, stable event ids for consumer dedup, SSRF defenses — complements `ingest-webhook-secure` (the receiver).

Each loads cleanly (frontmatter `name`/`description`/`when_to_use`), cross-references only real sibling skills, and follows the When-to-Use + NOT-this-skill + Steps structure.

### Onboarding & ease-of-use — no more dead-ends, clearer guidance

The first-run / no-key experience now guides instead of dumping a raw error, and the REPL surfaces more of what's available:

- **Headless with no key no longer dead-ends**: `sanook "task"` before any key is set now prints an actionable hint — run `sanook` for the wizard, or `export <ENV>=…` with the **provider console URL** to get a key — and, if a *different* provider's key is already in the environment, it suggests `sanook -m <that-provider> "…"`.
- **Smart first-run**: if an API key is already in the environment (e.g. you `export ANTHROPIC_API_KEY=…` before installing), sanook skips the setup wizard, picks that provider, and confirms `✅ ready` instead of asking you to re-enter everything.
- **Setup wizard** now shows the **console URL** for the chosen provider at the key step, and the run ends with a clear `✅ ตั้งค่าเสร็จ — พิมพ์งานได้เลย`.
- **Actionable key errors**: a missing key names the provider + console URL + how to set it; a wrong-format key shows a readable example (`sk-ant-…`, `AIza…`) instead of a raw regex (and the example is kept short so redaction doesn't mangle it).
- **Discoverability**: `/tools` now lists the orchestration tools (`task_parallel`/`task_spawn`/`task_collect`/`task_cancel`/`task_status`) and `diagnostics`; `/help` points to the shell-side commands (`search`/`index`/`brain`/`serve`/`mcp serve`/`config set`); the REPL empty-state hints `/help` and `/tools`.

### Token/cost tuning knobs — 1h cache, summarize-compaction, sub-agent routing, thinking budget

New `config.json` fields (and `SANOOK_*` env overrides) that trade tokens/cost without hurting quality — read once per turn via `agentTuning()`:

- **`cacheTtl: "5m" | "1h"`** (env `SANOOK_CACHE_TTL`): the Anthropic prompt-cache lifetime. `"1h"` keeps the cached preamble alive across pauses (lunch, a meeting) so resuming doesn't re-pay full price for it. Default `"5m"` (unchanged).
- **`compaction: "truncate" | "summarize"`** (env `SANOOK_COMPACTION`): when the conversation gets long, `"summarize"` condenses the dropped middle with a **cheap model** (the fast sibling of your main model, same key — `fastSibling()`) instead of truncating it — better recall at the same token budget. Used by `/compact` and proactively before very long turns; falls back to truncation if the summarizer fails (never blocks a turn). Default `"truncate"` (zero-LLM, unchanged). `src/compaction.ts` `summarizeCompact()` is pure (injected summarizer) and unit-tested with no network.
- **`SANOOK_SUBAGENT_MODEL`**: route all sub-agent work to a cheaper model (e.g. `haiku`) while the main agent keeps the strong one — big savings for exploration-heavy runs. Default: inherit the parent model.
- **`thinking: true | <budget>`** (env `SANOOK_THINKING`): opt-in Anthropic extended thinking on the **main** agent only (never sub-agents), with a hard `budgetTokens` cap so reasoning can't run away. Default off (no change).

### Token efficiency — line-range reads + targeted edits

Two quality-neutral cuts to per-turn token cost (the model asks for exactly what it needs):

- **`read_file` line ranges**: `read_file({ path, offset?, limit? })` returns just lines `offset..offset+limit` (with a `[lines A–B of N]` header) instead of the whole file. Paired with `grep` (which already returns line numbers), the model reads a small window around a symbol rather than an entire large file — large input-token savings, identical result. Default (no offset/limit) is unchanged. The system prompt now nudges grep→read-range over whole-file reads.
- **`edit_file` `replace_all`**: rename/repeated edits use a short `old_string` with `replace_all: true` instead of padding it with surrounding context for uniqueness (which the model otherwise sends twice, old + new). The ambiguous-match error now suggests `replace_all` rather than "add more context".
- **Terser replies**: the system prompt tells the agent not to paste back file contents / large code blocks it just read or edited (the user already sees the diff) — cuts output tokens with no loss.
- **Sub-agent model routing** (`SANOOK_SUBAGENT_MODEL`): opt-in env that routes all sub-agent work to a cheaper model (e.g. `haiku`) while the main agent keeps the strong model — big cost savings for exploration-heavy runs, default unchanged (inherit the parent model).

### LSP diagnostics — `diagnostics` tool (type errors without a full build)

A Node-native, zero-dependency Language Server Protocol client (`src/lsp/`) gives the agent a tight edit→check feedback loop: after editing a file it can pull the language server's diagnostics (type errors / lint) for that one file, no project-wide compile.

- **`diagnostics` tool**: `diagnostics({ path, content? })` → ranked errors/warnings as `✗ path:line:col message [code]`. Pass `content` to check an unsaved buffer. Respects worktree scoping (`agentCwd`) and the read-path guard.
- **Real LSP client** over Content-Length framing (distinct from MCP's newline framing): initialize handshake, `didOpen`/`didChange`, diagnostics that **settle** (a quiet period after the last publish so we return the final set, not an early empty one), and it answers server→client requests so a server can't stall. Positions convert from LSP 0-based to human 1-based.
- **Server pool**: servers are spawned once per (binary, workspace) and reused — re-checking a file becomes a `didChange`, so the slow project-load cost is paid once, not per call.
- **Zero-config floor**: sanook bundles no language servers (like ripgrep). It maps extension → conventional server (typescript-language-server, pyright, gopls, rust-analyzer, vscode-json-language-server, bash-language-server), detects whether it's installed (node_modules/.bin or PATH), and when it isn't, returns a clear install hint instead of crashing.
- Tests: the framing codec (split frames, multibyte, malformed-recovery), the client handshake + diagnostics-settle + server-request handling against a **fake server** (no real LSP needed), the server registry + binary detection, and the tool's graceful degradation. Verified end-to-end against a real `typescript-language-server` (caught TS2322 at the right position; pooled `didChange` cleared it after a fix).

### Real-time steering — interrupt a running turn + queue follow-ups (REPL)

The interactive REPL was input-locked while the agent worked, and Ctrl+C quit the whole app. Now a turn is steerable:

- **Interrupt mid-turn**: the running turn gets a real `AbortController` (wired into `runAgent`'s `signal`). Press **Esc** (or Ctrl+C) to stop the stream/tool loop right away and return to the prompt — without exiting the app. Partial output is kept for reference, the turn is dropped from the model history, and any files a tool already changed are recoverable via `/rewind`.
- **Type-ahead queue**: you can type while the agent is busy; pressing Enter **queues** the message (shown as `⏳ คิว …`) and it runs automatically as the next turn when the current one finishes. Interrupting clears the queue.
- Covered by an Ink integration test (mocked agent) asserting the signal is passed, input queues while busy, and Esc both aborts and clears the queue.

### Worktree isolation — safe parallel WRITE subagents (`task_parallel isolate:true`)

Parallel subagents that edit files would clobber a shared tree. Now each write subagent can run in its own throwaway **git worktree** (`src/worktree.ts`), branched from the current HEAD, and its changes are merged back afterward:

- **Per-agent working directory**: `AgentContext` gains a `cwd`, and every file tool (read/write/edit/list/glob/grep/bash) plus the write-confinement guard (`permission.allowedRoots`) now resolve through `agentCwd()`. A subagent's relative path (`src/foo.ts`) lands in ITS worktree, not the main tree — so isolation can't leak. The main agent is unchanged (no `cwd` ⇒ `process.cwd()`); the OS sandbox already confines writes to the active cwd, so a worktree is automatically sandboxed.
- **`task_parallel isolate:true`**: creates a worktree per write subagent, runs them concurrently in isolation, captures each worktree's diff, and applies them back to the main tree **sequentially** with `git apply --3way` — conflicts are reported (with the touched files), never silently overwritten. Worktrees are always cleaned up. Requires a git repo (falls back with a clear message otherwise).
- **`src/worktree.ts`**: `createWorktree` / `captureDiff` (incl. untracked) / `applyDiff` / `removeWorktree` / `runInWorktrees`, all over the existing `runGit` helper. The create→isolate→merge→cleanup lifecycle is unit-tested against a real throwaway git repo with an injected work callback (no agent/network), covering the round-trip, the parallel different-files case, empty diffs, non-git fallback, and conflict reporting.

### Subagent orchestration — parallel fan-out + background + nested (`task_parallel` / `task_spawn` / `task_collect` / `task_cancel` / `task_status`)

The single one-shot `task` subagent grows into a real orchestration layer (`src/orchestrate.ts`):

- **Parallel fan-out** (`task_parallel`): run up to 16 subagents concurrently with a real concurrency cap and **per-item error isolation** (one failure never sinks the batch); results returned in order. For independent work — explore N modules, review N angles — instead of serial subagents.
- **Background / async** (`task_spawn` → `task_collect` / `task_cancel` / `task_status`): spawn a detached subagent, get an id immediately, keep working, gather the result later in the same session, or cancel it. `task_collect` supports a timeout so the agent can poll instead of block; failures are captured as `error` state (never an unhandled rejection); `task_cancel` aborts via the subagent's `AbortSignal`.
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
