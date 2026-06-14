<div align="center">

# Sanook CLI

**A terminal AI coding agent — built from scratch in TypeScript.**

Bring your own key, run with any of 12 model providers, and let it remember what it did across sessions.

[![Version](https://img.shields.io/badge/version-0.3.0-2563eb.svg)](https://github.com/Sir-chawakorn/sanook-cli/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-22c55e.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-122%20passing-22c55e.svg)](#development)
[![CI](https://github.com/Sir-chawakorn/sanook-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Sir-chawakorn/sanook-cli/actions/workflows/ci.yml)

[Quickstart](#quickstart) · [Providers](#providers) · [Usage](#usage) · [Gateway](#gateway--scheduling) · [Skills](#skills) · [MCP](#mcp) · [Security](#security)

</div>

---

## Overview

Sanook is a small, transparent coding agent for your terminal. At its heart is a single loop —

```
prompt → LLM → tool call → result → loop → answer
```

— wrapped with everything that makes it usable for real work: a permission gate, a memory the agent writes itself, a long-running gateway with cron and chat channels, on-demand skills, MCP servers, and first-class git awareness.

It is **BYOK (bring your own key)** by design. Every provider connects with a **direct API key from that provider's own console** — Sanook never reuses OAuth or subscription credentials, because that violates provider terms and gets accounts banned.

## Quickstart

```bash
npm install -g sanook-cli

export ANTHROPIC_API_KEY=sk-ant-...        # or run `sanook` and use the setup wizard
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
| **Agent loop** | Built on the Vercel AI SDK 6 (`streamText` + `stopWhen` + `fullStream`), with streamed output, a cost meter, and a budget cap. |
| **Tools** | `read_file` · `write_file` · `edit_file` (multi-tier matcher) · `list_dir` · `glob` · `grep` · `run_bash`, plus git tools — gated by a permission layer that denies destructive commands and protected paths. |
| **Approval** | Interactive `ask` mode prompts `y/n` before any file write or shell command. `--yes` for auto-approve; headless defaults to safe-deny. |
| **Memory** | The agent writes its own notes (`remember`), recalls them across past sessions (`recall`), and `--continue` resumes the last run where it left off. |
| **Skills** | 69 built-in skills + install your own from a GitHub repo, URL, or local path. The agent can also author new skills after a repeatable task. |
| **Subagents** | A `task` tool spawns a fresh-context sub-agent for scoped exploration without bloating the main context — read-only by default, depth-guarded. |
| **Gateway + cron** | `sanook serve` runs a long-lived daemon: a loopback OpenAI-compatible HTTP endpoint plus a cron scheduler. Ask it in plain language and it schedules itself. |
| **Channels** | A Telegram adapter (long-polling, no public URL) lets you drive the agent from your phone — locked down with a required allowlist and private-chat-only policy. |
| **MCP** | Connect any Model Context Protocol server (filesystem, GitHub, Postgres, …) via `~/.sanook/mcp.json`. |
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
sanook -c "<task>"       resume the latest session
sanook --plan "<task>"   plan mode (read-only)
sanook --json "<task>"   JSONL output for scripts / CI

  -m, --model <spec>     model or provider:model-id
  -b, --budget <usd>     stop when estimated cost exceeds this
  -y, --yes              auto-approve tool calls (skip ask-mode)
  -v, --version          print version
  -h, --help             show help
```

**REPL slash commands:** `/model` · `/tools` · `/skills` · `/cost` · `/clear` · `/compact` · `/help` · `/quit`

## Gateway & scheduling

`sanook serve` starts a single long-lived process that hosts an HTTP API, a cron scheduler, and optional chat channels — all driving the same agent core.

```bash
sanook serve --port 8787                       # HTTP (127.0.0.1 only) + scheduler
sanook cron add "every 30m" "check the CI"     # also "09:00", an ISO time, or "now"
sanook cron list
sanook cron rm <id>
```

The HTTP server binds to **loopback only** and authenticates every endpoint (except `/health`) with a bearer token stored at `~/.sanook/gateway/token` (chmod 600). It speaks the OpenAI chat-completions shape, so existing clients work unchanged:

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

A skill is a `SKILL.md` file (front-matter + instructions) the agent loads on demand. Sanook ships with 69 built-in skills and can install more.

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

It creates a full folder taxonomy (`Projects/`, `Sessions/`, `Shared/` memory layer, `Goals/`, `Research/`, …), an `_Index.md` in every folder, seed memory files, and a portable AI **operating constitution** (`CLAUDE.md` / `GEMINI.md` / `AGENTS.md`) so any AI agent works with the vault consistently. The first-run setup wizard also offers to create one.

Everything is **create-if-missing** — re-running never overwrites your notes. Point an Obsidian or filesystem MCP server at the workspace to let the agent read and write it.

## MCP

Connect Model Context Protocol servers (stdio) with the same config shape you already use elsewhere:

```jsonc
// ~/.sanook/mcp.json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] }
  }
}
```

Their tools are merged into the agent's toolset automatically. `/tools` in the REPL lists everything currently available.

## Configuration

Everything lives under `~/.sanook/` (with per-project `.sanook/` overrides where relevant):

```
~/.sanook/auth.json          API keys (chmod 600)
~/.sanook/memory/            auto-memory the agent writes
~/.sanook/sessions/          saved conversations (for --continue)
~/.sanook/skills/<name>/     installed SKILL.md files
~/.sanook/mcp.json           MCP servers  { "mcpServers": { … } }
~/.sanook/hooks.json         PreToolUse / PostToolUse hooks
~/.sanook/gateway/           gateway token + task ledger
SANOOK.md                    project memory (hierarchical, like a system prompt)
```

## Security

Sanook runs shell commands and edits files, so safety is built into the core rather than bolted on:

- **BYOK, direct keys only** — OAuth and subscription tokens are rejected by an explicit guard (`ya29.`, `Bearer`, `sk-ant-oat…`). This keeps you within every provider's terms of service.
- **Permission gate** — destructive commands (`rm -rf`, `git reset --hard`, `push --force`, fork bombs, …) and writes to protected paths are denied; interactive `ask` mode confirms mutations.
- **Secret redaction** — API keys are stripped from error messages and logs.
- **Gateway** — HTTP binds to `127.0.0.1` only and requires a bearer token on every non-health endpoint.
- **Telegram** — fail-closed: a required allowlist, private-chat-only, per-chat rate-limiting, and generic error replies that never reveal internal paths.

Hardened across several adversarial security reviews covering command injection, prompt injection, concurrency, and credential leakage.

## Development

```bash
npm install
npm run build       # → dist/
npm test            # vitest — 122 tests
npm run typecheck   # tsc --noEmit (strict)
npm run dev -- "…"  # run from source without building
```

CI runs the suite across macOS / Linux / Windows on Node 22 and 24. Requires **Node ≥ 22**.

## License

[Apache-2.0](LICENSE)

<div align="center">
<sub>Built from scratch in TypeScript on the Vercel AI SDK — no framework, no magic.</sub>
</div>
