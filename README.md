<div align="center">

# Sanook CLI

**The open-source terminal AI coding agent that remembers across sessions.**

Bring your own key · 12 providers · MCP · a built-in **"second brain"** that gives the AI durable memory across sessions — the thing Claude Code, Codex, and Gemini CLI lose at the session boundary.

🇹🇭 [อ่านภาษาไทย](README.th.md)

[![npm](https://img.shields.io/npm/v/sanook-cli.svg?color=2563eb)](https://www.npmjs.com/package/sanook-cli)
[![downloads](https://img.shields.io/npm/dm/sanook-cli.svg?color=2563eb)](https://www.npmjs.com/package/sanook-cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-22c55e.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-477%20passing-22c55e.svg)](#development)
[![CI](https://github.com/Sir-chawakorn/sanook-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Sir-chawakorn/sanook-cli/actions/workflows/ci.yml)

[Quickstart](#quickstart) · [Providers](#providers) · [Usage](#usage) · [Gateway](#gateway--scheduling) · [Skills](#skills) · [MCP](#mcp) · [Security](#security)

<!-- 📹 DEMO GIF — record the close-session → reopen → "it remembered" loop (asciinema + agg), save to docs/demo.gif, then uncomment: -->
<!-- ![sanook-cli demo](docs/demo.gif) -->

</div>

---

## Overview

Sanook is a small, transparent coding agent for your terminal. At its heart is a single loop —

```
prompt → LLM → tool call → result → loop → answer
```

— wrapped with everything that makes it usable for real work: a permission gate, a memory the agent writes itself, a long-running gateway with cron and chat channels, on-demand skills, MCP servers, and first-class git awareness.

It is **BYOK (bring your own key)** by design. Every provider connects with a **direct API key from that provider's own console** — Sanook never reuses OAuth or subscription credentials, because that violates provider terms and gets accounts banned.

## How it compares

The agent loop, BYOK, and MCP are table stakes now. What Sanook has that the big vendor CLIs don't is **memory that survives the session** — a structured Obsidian "second brain" the agent reads at the start of every run.

| | **Sanook** | Claude Code | Codex CLI | Gemini CLI |
|---|:---:|:---:|:---:|:---:|
| Open-source | ✅ | ❌ | ✅ | ✅ |
| Bring your own key | ✅ | — | ✅ | ✅ |
| Providers | **12** | 1 | 1 | 1 |
| Local models (Ollama / LM Studio) | ✅ | ❌ | ❌ | ❌ |
| MCP (stdio **+ remote HTTP**) | ✅ | ✅ | ✅ | ✅ |
| OS sandbox (Seatbelt / bubblewrap) | ✅ | ✅ | ✅ | ✅ |
| Checkpoint / rewind | ✅ | ✅ | ✅ | ✅ |
| Image / vision input | ✅ | ✅ | ✅ | ✅ |
| Prompt caching | ✅ | ✅ | ✅ | ✅ |
| **Durable cross-session memory** | ✅ | ❌ | ❌ | ❌ |
| **Local gateway + cron + Telegram** | ✅ | ❌ | ❌ | ❌ |

On raw benchmark scores the frontier vendors win — Sanook's bet is **portability + persistent memory**, not beating Opus on SWE-bench. Use whatever fits; this one remembers.

## Quickstart

Install **globally** — the `-g` is required (needs **Node ≥ 22**; check with `node -v`):

```bash
npm install -g sanook-cli
```

> ⚠️ **`'sanook' is not recognized` / command not found?** You installed it locally — `npm i sanook-cli` (without `-g`) drops it into the current folder, **not on your PATH**, so the `sanook` command isn't found. Fix: reinstall with `npm install -g sanook-cli`, or just run it via **`npx sanook`** (uses the local copy you already installed).
> Run **`npx sanook doctor`** to auto-diagnose Node version / PATH / install state and print the exact fix for your OS (incl. a safe Windows PATH one-liner).

Set an API key (or run `sanook` with no task for the interactive setup wizard):

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # macOS / Linux
setx ANTHROPIC_API_KEY "sk-ant-..."        # Windows (export won't work in cmd) — then open a NEW terminal

sanook "read package.json and list the dependencies"
```

Run `sanook` with no task to drop into an interactive REPL. On the very first run with no key configured, a setup wizard walks you through picking a provider, pasting a key, and choosing a model.

```bash
sanook                          # interactive REPL
sanook "fix the failing test"   # one-shot, headless
sanook --json "..."             # JSONL output for CI / scripts
```

## Features

| Area | What you get |
|---|---|
| **Agent loop** | Built on the Vercel AI SDK 6 (`streamText` + `stopWhen` + `fullStream`), with streamed output, a cost meter, a budget cap, Anthropic **prompt caching** on the static preamble, and rate-limit-aware retry/backoff (distinct from auth failures) with model fallback. |
| **Tools** | `read_file` · `write_file` · `edit_file` (multi-tier matcher) · `list_dir` · `glob` · `grep` · `run_bash`, plus git tools — gated by a permission layer that denies destructive commands, protected paths, and paths outside the workspace/brain by default. Non-bash tools are timeout-guarded so a runaway read/grep can't hang the loop. |
| **Sandbox** | `run_bash` is confined by an OS sandbox — **Seatbelt** on macOS, **bubblewrap** on Linux — so shell writes stay inside the workspace/brain/tmp (reads + network unaffected). Opt out with `SANOOK_NO_SANDBOX=1`. |
| **Approval** | `ask` mode is the default and prompts `y/n` before any file write or shell command. `--yes` for auto-approve; headless ask-mode safely denies mutations when no approval UI exists. |
| **Input** | Multiline editing, `↑`/`↓` persisted prompt history, readline keys (Ctrl-A/E/U/K/W), and `@file` mentions that inline a file's contents (or attach an **image** for vision-capable models). |
| **Checkpoint** | A shadow-git snapshot is taken before each turn; `/rewind` restores the files **and** truncates the conversation — recoverable (it stashes the current state first). |
| **Memory** | The agent writes its own notes (`remember`), recalls them across past sessions (`recall`), and `--continue` resumes the latest run for the current project. |
| **Repo map** | A lightweight symbol map of the repo (zero-dep, git-aware) is injected at session start so the agent picks the right files without blind grepping. |
| **Skills** | Built-in skills + install your own from a GitHub repo, URL, or local path. The agent can also author new skills after a repeatable task. |
| **Custom commands** | Drop a `.sanook/commands/<name>.md` prompt template and call it as `/<name>` (project commands require trust). |
| **Subagents** | A `task` tool spawns a fresh-context sub-agent for scoped exploration without bloating the main context — read-only by default, depth-guarded. |
| **Gateway + cron** | `sanook serve` runs a long-lived daemon: a loopback OpenAI-compatible HTTP endpoint plus a cron scheduler. Ask it in plain language and it schedules itself. |
| **Channels** | A Telegram adapter (long-polling, no public URL) lets you drive the agent from your phone — locked down with a required allowlist and private-chat-only policy. |
| **MCP** | Connect any Model Context Protocol server over **stdio or remote Streamable-HTTP** (filesystem, GitHub, Postgres, hosted servers, …) via `~/.sanook/mcp.json`. |
| **Git** | Branch, uncommitted changes, and recent commits are injected automatically, with `git_status` / `git_diff` / `git_log` / `git_commit` tools. |
| **Hooks** | Run your own command before/after any tool. A non-zero `PreToolUse` exit blocks the tool — enforce lint, format, or policy. |
| **Plan mode** | `--plan` restricts the agent to read-only tools and asks it to produce a plan before touching anything. |
| **Auto-compaction** | A token-aware sliding window keeps long sessions under the context limit with zero extra LLM cost. |
| **Second brain** | `sanook brain init` scaffolds a structured Obsidian "second-brain" workspace (folders + `_Index` + a portable AI operating constitution) for organising work and giving the agent durable, cross-session memory. |

## Providers

One model spec, twelve providers. Switch with `-m <spec>` on the command line or `/model` in the REPL.

| Provider | Spec example | Key |
|---|---|---|
| Anthropic (Claude) | `-m sonnet`, `-m opus`, `-m haiku` | `ANTHROPIC_API_KEY` |
| Google (Gemini) | `-m gemini`, `-m google:gemini-2.5-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| OpenAI | `-m gpt`, `-m openai:gpt-5.5` | `OPENAI_API_KEY` |
| DeepSeek | `-m deepseek` | `DEEPSEEK_API_KEY` |
| xAI (Grok) | `-m grok` | `XAI_API_KEY` |
| Mistral | `-m mistral` | `MISTRAL_API_KEY` |
| Groq | `-m groq:fast` | `GROQ_API_KEY` |
| MiniMax | `-m minimax` | `MINIMAX_API_KEY` |
| GLM (Zhipu) | `-m glm` | `ZHIPU_API_KEY` |
| Ollama | `-m ollama` | — (local) |
| LM Studio | `-m lmstudio` | — (local) |
| OpenAI Codex | `-m codex` | via the official Codex CLI |

A spec is an alias (`sonnet`), a `provider:model-id` pair (`openai:gpt-5.5`), or a bare model id. `sanook models <provider>` lists the curated ids and, when a key is set, verifies them against the provider's live `/models` endpoint.

```bash
sanook models                 # list all providers
sanook models anthropic       # curated ids (+ live verification if a key is set)
```

## Usage

```
sanook "<task>"          run one task (headless)
sanook                   interactive REPL
sanook -c "<task>"       resume the latest session for this project
sanook --continue-any    resume the newest session across all projects
sanook --plan "<task>"   plan mode (read-only)
sanook --json "<task>"   JSONL output for scripts / CI
sanook update            update the CLI to the latest npm release

  -m, --model <spec>     model or provider:model-id
  -b, --budget <usd>     stop when estimated cost exceeds this
  -y, --yes              auto-approve tool calls (skip ask-mode)
  -v, --version          print version
  -h, --help             show help
```

**REPL slash commands:** `/model` · `/tools` · `/skills` · `/cost` · `/diff` · `/undo` · `/rewind` · `/clear` · `/compact` · `/help` · `/quit` — plus your own `.sanook/commands/*.md`. Input supports `↑`/`↓` history, `@file` mentions (text or image), and multiline (trailing `\` or Alt+Enter).

## Updating

Use the built-in updater whenever a new CLI version is available:

```bash
sanook update
sanook update --check   # check only
```

It checks the npm `latest` release for `sanook-cli` and, when newer than your installed version, runs `npm install -g sanook-cli@latest`.

When you launch the interactive TUI with plain `sanook`, the CLI checks for updates at most once per day. If a newer version exists, it asks `Yes/No` before running the same updater. Set `SANOOK_DISABLE_UPDATE_CHECK=1` to silence the prompt.

## Gateway & scheduling

`sanook serve` starts a single long-lived process that hosts an HTTP API, a cron scheduler, and optional chat channels — all driving the same agent core.

```bash
sanook serve --port 8787                       # HTTP (127.0.0.1 only) + scheduler
sanook cron add "every 30m" "check the CI"     # also "09:00", an ISO time, or "now"
sanook cron list
sanook cron rm <id>
```

The HTTP server binds to **loopback only** and authenticates every endpoint (except `/health`) with a bearer token stored at `~/.sanook/gateway/token` (chmod 600). It runs mutating tools in `ask` mode by default; opt into unattended writes with `sanook config set permissionMode auto` or `SANOOK_GATEWAY_ALLOW_WRITE=1`. It speaks the OpenAI chat-completions shape, so existing clients work unchanged:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $(cat ~/.sanook/gateway/token)" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"summarise today's commits"}]}'
```

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | liveness (public) |
| `POST` | `/v1/chat/completions` | run the agent (OpenAI-compatible) |
| `GET` / `POST` | `/tasks` | list / enqueue scheduled tasks |

### Telegram channel

Set two environment variables before `sanook serve` and the gateway adds a Telegram adapter via long-polling (no public URL needed):

```bash
export TELEGRAM_BOT_TOKEN=123:abc
export TELEGRAM_ALLOWED_CHATS=5222385839   # required — comma-separated chat ids
sanook serve
```

The channel is **fail-closed**: with no allowlist it refuses to start, it accepts private chats only, and it never leaks internal errors back to the sender. See [Security](#security).

## Skills

A skill is a `SKILL.md` file (front-matter + instructions) the agent loads on demand. Sanook ships with built-in skills and can install more.

```bash
sanook skill list                          # browse all skills
sanook skill add anthropics/skills         # from a GitHub repo
sanook skill add https://…/SKILL.md        # from a URL
sanook skill add ./my-skill                # from a local path
sanook skill remove my-skill
```

> ⚠️ A skill is an instruction the agent will follow. Install only from sources you trust.

## Second brain

Scaffold a structured [Obsidian](https://obsidian.md) workspace for organising your work and giving the agent a durable, cross-session memory:

```bash
sanook brain init                  # interactive — asks where + a few identity questions
sanook brain init ~/notes/brain    # non-interactive (with --yes)
```

It creates a full folder taxonomy (`Projects/`, `Sessions/`, `Shared/` memory layer, `Goals/`, `Research/`, `Skills/`, …), an `_Index.md` in every folder, seed memory files, and a portable AI **operating constitution** (`CLAUDE.md` / `GEMINI.md` / `AGENTS.md`) so any AI agent works with the vault consistently. It ships with research-backed operating rules — context-assembly (anti context-rot), an intake quarantine + injection-scan gate, bi-temporal fact validity, provenance tracking, a verification-gated `Skills/` library, and sleep-time consolidation. The first-run setup wizard also offers to create one.

Everything is **create-if-missing** — re-running never overwrites your notes. Point an Obsidian or filesystem MCP server at the workspace to let the agent read and write it.

### Brain search

Ranked search over the vault **and** the agent's memory, past sessions, and skills — one surface, no native binaries:

```bash
sanook index                       # incremental index of vault + memory + sessions + skills (O(delta))
sanook search "vercel edge deploy" # ranked hits with snippets
sanook search "race condition" --mode hybrid --source vault,memory --limit 5
```

- **Zero-config floor** — a pure-TypeScript BM25 inverted index (genuine corpus-stat IDF, title boost, `Intl.Segmenter` word breaks for Thai). No SQLite, no Bun, no native binary, no API key, no network.
- **Optional semantic** — `--mode hybrid|semantic` embeds through your *existing* provider key (OpenAI / Mistral / Google / …), stores compact Float32 vectors locally, and fuses with BM25 via Reciprocal Rank Fusion. Activates only when a key resolves; degrades silently to BM25 otherwise. Configure with `sanook config set embeddingModel openai:text-embedding-3-small` (or `SANOOK_EMBEDDING_MODEL`).
- **Incremental** — only changed files are re-read (mtime+sha manifest); deleted files are evicted. Run after editing the vault, or wire it into a hook/cron.

The agent's `recall` tool uses the same engine, so remembered facts and vault notes are searchable the moment they exist.

## MCP

Connect Model Context Protocol servers over **stdio or remote Streamable-HTTP** with the same config shape you already use elsewhere:

```jsonc
// ~/.sanook/mcp.json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] },
    "remote":     { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer <token>" } }
  }
}
```

Add servers from the CLI too: `sanook mcp add fs npx -y @modelcontextprotocol/server-filesystem /path` (stdio) or `sanook mcp add remote https://example.com/mcp` (a URL is detected as remote HTTP).

Their tools are merged into the agent's toolset automatically. `/tools` in the REPL lists everything currently available.

sanook is also an MCP **server**: `sanook mcp serve` exposes your brain (`sanook_search` / `sanook_recall` / `sanook_remember` / `sanook_index` / `sanook_stats`) over stdio, so Claude Desktop, Cursor, or any MCP host can query it:

```jsonc
// in another host's MCP config
{ "mcpServers": { "sanook-brain": { "command": "sanook", "args": ["mcp", "serve"] } } }
```

Project-local `.sanook/mcp.json`, `.sanook/hooks.json`, `.sanook/skills/`, and `.sanook/commands/` are ignored until the project is trusted:

```bash
sanook trust status
sanook trust add       # allow this project's .sanook mcp/hooks/skills/commands
sanook trust remove
```

## Configuration

Everything lives under `~/.sanook/` (with per-project `.sanook/` overrides where relevant):

```
~/.sanook/auth.json          API keys (chmod 600)
~/.sanook/memory/            auto-memory the agent writes
~/.sanook/search/            brain-search index + optional embedding vectors (regenerable via `sanook index`)
~/.sanook/sessions/          saved conversations (for --continue)
~/.sanook/skills/<name>/     installed SKILL.md files
~/.sanook/mcp.json           MCP servers  { "mcpServers": { … } }
~/.sanook/hooks.json         PreToolUse / PostToolUse hooks
~/.sanook/gateway/           gateway token + task ledger
~/.sanook/trusted-projects.json project roots allowed to load project .sanook extensions
SANOOK.md                    project memory (hierarchical, like a system prompt)
```

Untrusted project config can set ordinary project defaults, but it cannot lower `permissionMode` to `auto`; trust the project first if you want project-local config to control mutation approval.

### Token / cost tuning

Quality-neutral knobs in `~/.sanook/config.json` (or the matching `SANOOK_*` env var) to cut tokens/cost:

| `config set …` | env | effect |
|---|---|---|
| `cacheTtl 1h` | `SANOOK_CACHE_TTL=1h` | keep the cached system preamble alive for 1h (default `5m`) — cheaper to resume after a pause |
| `compaction summarize` | `SANOOK_COMPACTION=summarize` | when context gets long, condense it with a **cheap model** instead of truncating — better recall at the same budget (default `truncate`, zero-LLM) |
| — | `SANOOK_SUBAGENT_MODEL=haiku` | run all sub-agent work (exploration/search) on a cheaper model while the main agent keeps the strong one |
| `summaryModel <spec>` | `SANOOK_SUMMARY_MODEL=<spec>` | model used for summarize-compaction (default: the fast sibling of your main model) |
| `embeddingModel <spec>` | `SANOOK_EMBEDDING_MODEL=<spec>` | model used for semantic search embeddings (for example `openai:text-embedding-3-small`) |
| `thinking 4000` | `SANOOK_THINKING=4000` | opt-in Anthropic extended thinking on the main agent with a `budgetTokens` cap (default off) |

Read-side savings are automatic: the agent reads file ranges (`read_file` with `offset`/`limit`) and edits with minimal `old_string` / `replace_all` rather than rewriting whole files.

Useful environment flags:

```bash
SANOOK_MODEL=sonnet                 # default model alias or provider:model
SANOOK_ALLOW_OUTSIDE_WORKSPACE=1    # allow file tools outside cwd/brain
SANOOK_GATEWAY_ALLOW_WRITE=1        # let sanook serve run mutating tools unattended
SANOOK_HOOKS_INHERIT_ENV=1          # pass full env to hooks instead of a minimal safe env
SANOOK_DISABLE_PERSISTENCE=1        # do not save sessions, memory, prompt history, or worklogs
SANOOK_DISABLE_UPDATE_CHECK=1       # do not show interactive update prompts
SANOOK_DISABLE_WORKLOG=1            # do not append second-brain worklogs
SANOOK_TRUST_PROJECT=1              # temporary trust override for project .sanook extensions
```

## Security

Sanook runs shell commands and edits files, so safety is built into the core rather than bolted on:

- **BYOK, direct keys only** — OAuth and subscription tokens are rejected by an explicit guard (`ya29.`, `Bearer`, `sk-ant-oat…`). This keeps you within every provider's terms of service.
- **Permission gate** — destructive commands (`rm -rf`, `git reset --hard`, `push --force`, fork bombs, …), protected paths (`.env`, `.git`, `node_modules`, credential folders), and paths outside the workspace/brain are denied unless explicitly opted in.
- **OS sandbox** — `run_bash` runs under Seatbelt (macOS) / bubblewrap (Linux) when available, confining shell writes to the workspace/brain/tmp — defense in depth beyond the regex blocklist (`SANOOK_NO_SANDBOX=1` to disable).
- **Project trust gate** — project `.sanook/mcp.json`, `.sanook/hooks.json`, `.sanook/skills/`, and `.sanook/commands/` can execute or steer the agent, so they are ignored until `sanook trust add`.
- **Secret redaction** — API keys are stripped from error messages, saved sessions, memory, and worklogs.
- **Safe fallback** — provider fallback does not retry after a mutating tool call has already happened, avoiding duplicate side effects.
- **Gateway** — HTTP binds to `127.0.0.1` only and requires a bearer token on every non-health endpoint.
- **Telegram** — fail-closed: a required allowlist, private-chat-only, per-chat rate-limiting, and generic error replies that never reveal internal paths.

Hardened across several adversarial security reviews covering command injection, prompt injection, concurrency, and credential leakage.

## Development

```bash
npm install
npm run build       # → dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit (strict)
npm run dev -- "…"  # run from source without building
```

CI runs the suite across macOS / Linux / Windows on Node 22 and 24. Requires **Node ≥ 22**.

## License

[Apache-2.0](LICENSE)

---

<div align="center">

**Built by [Sanook AI](https://www.facebook.com/sanookai)** — AI tools & education 🇹🇭

[Facebook](https://www.facebook.com/sanookai) · [X / Twitter](https://x.com/sanook_ai)

<sub>Built from scratch in TypeScript on the Vercel AI SDK — no framework, no magic.</sub>

</div>
