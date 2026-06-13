# Sanook

A terminal AI coding agent, built from scratch in TypeScript. Bring your own key, works with any model, and remembers what it did across sessions.

```bash
npm install -g sanook-cli
export ANTHROPIC_API_KEY=sk-ant-...
sanook "read package.json and list the dependencies"
```

First run with no key set opens a setup wizard (pick a provider, paste a key, choose a model). After that, `sanook` drops you into an interactive REPL, or takes a task directly for headless/CI use.

## What it does

The core is a small agent loop — `prompt → LLM → tool call → result → loop → answer` — wrapped with the things that make it usable for real work:

| Area | What you get |
|---|---|
| **Providers** | 12 providers behind one BYOK registry — Anthropic, Google, OpenAI, DeepSeek, xAI, Mistral, Groq, MiniMax, GLM, Ollama, LM Studio, plus OpenAI Codex via the official CLI. Pick any model the provider offers. |
| **Memory** | Auto-memory the agent writes itself (`remember`), searchable recall across past sessions, and `--continue` to resume the last run. The REPL keeps conversation context within a session. |
| **Skills** | Drop a `SKILL.md` in `~/.sanook/skills/` and the agent loads it on demand. It can also write its own skills after finishing a repeatable task. |
| **Subagents** | A `task` tool spawns a fresh-context sub-agent to explore or do scoped work without bloating the main context. Read-only by default. |
| **Gateway + cron** | `sanook serve` runs a long-lived daemon: a loopback HTTP endpoint (OpenAI-compatible) plus a cron scheduler. Tell the agent "run this every morning at 9" and it schedules itself. |
| **MCP** | Connect any Model Context Protocol server (filesystem, GitHub, Postgres, …) via `~/.sanook/mcp.json` — same config shape you already use elsewhere. |
| **Git** | The agent sees branch, uncommitted changes, and recent commits automatically, with `git_status` / `git_diff` / `git_log` / `git_commit` tools. |
| **Hooks** | Run your own command before/after any tool (`~/.sanook/hooks.json`). A non-zero exit on `PreToolUse` blocks the tool — enforce lint, format, or policy. |
| **Plan mode** | `--plan` restricts the agent to read-only tools and asks it to produce a plan before touching anything. |

Every provider connects with a **direct API key from that provider's own console**. Sanook never reuses OAuth or subscription credentials — that violates provider terms and gets accounts banned.

## Models

Switch with `-m <spec>` or `/model` in the REPL. A spec is an alias (`sonnet`), `provider:model-id` (`openai:gpt-5.5`), or a bare model id.

```bash
sanook -m sonnet "..."            # Anthropic
sanook -m gemini "..."            # Google
sanook -m groq:fast "..."         # Groq
sanook -m codex "..."             # OpenAI Codex via ChatGPT plan (official CLI)
sanook -m ollama "..."            # local, no key
```

`/model` with no argument lists what the current provider offers. The setup wizard fetches the live model list from the provider when you add a key.

## Gateway & scheduling

```bash
sanook serve --port 8787                       # HTTP (127.0.0.1 only) + cron scheduler
sanook cron add "every 30m" "check the CI"     # or "09:00", an ISO time, or "now"
sanook cron list
```

The gateway binds to loopback only and authenticates with a bearer token stored at `~/.sanook/gateway/token` (chmod 600). Scheduled tasks run as fresh agents when their time comes. You can also let the agent schedule work itself — just ask it in plain language.

## CLI

```
sanook "<task>"          run one task (headless)
sanook                   interactive REPL
sanook -c "<task>"       resume the latest session
sanook --plan "<task>"   plan mode (read-only)
sanook --json "<task>"   JSONL output for scripts/CI

  -m, --model <spec>     model or provider:model
  -b, --budget <usd>     stop when estimated cost exceeds this
```

REPL slash commands: `/model` `/cost` `/clear` `/compact` `/help` `/quit`.

## Configuration

Everything lives under `~/.sanook/` (and per-project `.sanook/`):

```
~/.sanook/auth.json        API keys (chmod 600)
~/.sanook/memory/          auto-memory the agent writes
~/.sanook/sessions/        saved conversations (for --continue)
~/.sanook/skills/<name>/   SKILL.md files
~/.sanook/mcp.json         MCP servers  { "mcpServers": { ... } }
~/.sanook/hooks.json       PreToolUse / PostToolUse hooks
SANOOK.md                  project memory (hierarchical, like a system prompt)
```

## Build from source

```bash
npm install
npm run build       # → dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run dev -- "..."  # run without building
```

Requires Node ≥ 22.

## License

Apache-2.0
