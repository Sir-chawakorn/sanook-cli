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

## Status

Phase 0 spike: agent loop + two tools, with `typecheck` and `test` green. Next on the roadmap: full file tools (write/edit/grep) → multi-provider routing → context compaction → an Ink TUI.

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

## License

Apache-2.0
