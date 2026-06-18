---
tags: [research, hermes, sanook, cli, prompt-budget]
note_type: research
created: 2026-06-19
updated: 2026-06-19
parent: "[[Research/_Index]]"
source:
  - https://github.com/nousresearch/hermes-agent
  - https://github.com/nousresearch/hermes-agent/blob/main/hermes_cli/prompt_size.py
  - https://github.com/nousresearch/hermes-agent/blob/main/hermes_cli/subcommands/prompt_size.py
  - https://github.com/nousresearch/hermes-agent/blob/main/pyproject.toml
---

# Hermes Python Architecture for Sanook

> Research note for converting useful Hermes Agent backend ideas into Sanook-native TypeScript features without copying Hermes runtime assumptions wholesale.

Source inspected: local clone of `nousresearch/hermes-agent` fetched on 2026-06-19, latest `origin/main` commit `0fa7d6f6609c515b6eaafda0594a1472d11d93b5` (`fix(desktop): never persist or restore a named custom provider as bare "custom" (#48547)`).

## Finding

Hermes' Python layer is a full backend, not a small helper. It covers agent runtime, provider and gateway adapters, CLI subcommands, tools, MCP/plugin/LSP/browser support, schedulers, memory, voice/transcription, dashboards, and tests. Sanook should not port that Python runtime directly because Sanook's core loop is already TypeScript and Vercel AI SDK based.

The most useful near-term Sanook adaptation is Hermes' `prompt-size` idea: an offline diagnostic that shows fixed prompt/context/tool-schema weight before the user calls a model. This directly supports Sanook's differentiator: second-brain plus skills plus MCP, all of which can quietly grow context cost.

## Sanook Adaptation

- Add `sanook prompt-size [--json]`.
- Count the same prompt blocks Sanook injects at runtime: base system, personality overlay, auto-memory, skills index, second-brain context, project memory, repo map, and git context.
- Count built-in tool schemas separately.
- Do not spawn MCP servers in this command. Live MCP catalogs belong in `sanook mcp list --tools`.
- Keep counts approximate because tokenizer details vary by model.

## Why This Comes Before Bigger Ports

- It improves user trust: Sanook can explain what it is about to send.
- It makes optimization concrete: big skills, repo maps, and brain context become visible.
- It is low-risk: no Python bridge, no provider dependency, no background service architecture change.
- It fits the existing brand promise: readable, recoverable, remembered.

## Follow-Up Ideas

- Add `/prompt-size` or a context-meter overlay inside the REPL.
- Add warning thresholds in `brain doctor` when brain context grows too large.
- Add a JSON field to support dumps so users can share context-size diagnostics without secrets.
- Later, consider Hermes-style optional dependency profiles only if Sanook starts shipping heavyweight adapters.

up:: [[Research/_Index]]

