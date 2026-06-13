# Sanook

A terminal AI coding agent, built from scratch in TypeScript. BYOK — bring your own key, works with any model.

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev -- "read package.json and list the dependencies"
```

The agent finds files on its own (via `ls`/`grep`/`read`), runs shell commands, and answers — you don't tell it where things are.

**BYOK:** Sanook connects to each provider with a direct API key from that provider's own console (Anthropic, Google AI Studio, OpenAI). It never uses OAuth or subscription-credential reuse — that violates provider terms and gets accounts banned.

## Why

AI coding CLIs became the default way to write code, but most people treat the harness as a black box. Sanook is built from scratch to understand every layer — the agent loop, tool calling, context management, multi-provider BYOK. It's a learning and portfolio project, not a drop-in replacement for the big tools.

## How it works

At its core it's a small agent loop:

```
prompt → LLM → tool call (read_file / run_bash) → result → loop → answer
```

| File | Role |
|------|------|
| `src/loop.ts` | the agent loop — `streamText` + `stopWhen` (AI SDK 6), streams every step |
| `src/tools.ts` | file + bash tools — zod-typed, output-capped, with a destructive-command guard |
| `src/bin.ts` | CLI entry — argv → loop → live streamed output |

## Commands (REPL)

```
/model [spec]   show or switch model        /cost     tokens + cost this session
/clear          reset conversation          /compact  shrink context
/help           list commands               /quit     exit
```

## Status

**v0.1.0** — agent loop, full file tools (read/write/edit/list/glob/grep/bash + permission gate), multi-provider BYOK, cost meter with budget cap, hierarchical `SANOOK.md` memory + compaction, and an Ink TUI with slash commands. Headless `--json` mode for CI. `typecheck` + `test` green on mac/linux/windows × Node 22/24.

```bash
npm run build       # → dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

## License

Apache-2.0
