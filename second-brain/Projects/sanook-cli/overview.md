---
tags: [project, project-overview, sanook-cli]
note_type: project-overview
status: active
created: 2026-06-20
updated: 2026-06-20
parent: "[[Projects/sanook-cli/_Index]]"
repo_path: /Users/chawakornbuasontorn/dev/sanook-cli
---

> Project overview — goal, scope, stack, and verify commands for Sanook CLI.

# Sanook CLI

## เป้าหมาย (Goal)

Terminal AI coding agent (BYOK) with durable second-brain memory across sessions — the moat vs Claude Code / Codex / Gemini CLI.

## Scope / Non-goals

- In scope: agent loop, MCP, gateway, second-brain vault tooling, search, TUI
- Out of scope: hosted SaaS, OAuth/subscription key reuse, Hermes full TUI port

## Tech / Stack

- Node ≥ 22, TypeScript strict, Vercel AI SDK 6, Ink REPL
- Vitest CI, bundled `second-brain/` vault template ships with npm package

## Verify

```bash
npm run typecheck && npm test
```

## Related

- Repo map: [[Projects/sanook-cli/repo]]
- Live status: [[Projects/sanook-cli/current-state]]
- Roadmap: [[Projects/sanook-cli/second-brain-feature-roadmap]]

up:: [[Projects/sanook-cli/_Index]]
