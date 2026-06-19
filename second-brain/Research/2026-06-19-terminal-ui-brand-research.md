---
tags: [research, cli, tui, brand, sanook]
note_type: research
created: 2026-06-19
updated: 2026-06-19
parent: "[[Research/_Index]]"
source:
  - https://clig.dev/
  - https://docs.anthropic.com/en/docs/claude-code/overview
  - https://github.com/google-gemini/gemini-cli
  - https://github.com/openai/codex
  - https://github.com/Aider-AI/aider
  - https://github.com/charmbracelet/bubbletea
  - https://github.com/charmbracelet/lipgloss
---

# Terminal UI Brand Research

> Purpose: Capture outside CLI/TUI brand references and translate them into Sanook-specific startup banner and service-route decisions.

## Notes

- CLIG.dev: good CLIs are human-first, say just enough, and make useful next actions discoverable. For Sanook, the banner should be a launch surface, not decoration.
- Gemini CLI: the README leads with a screenshot and immediately frames benefits around built-in tools, MCP, terminal-first use, checkpointing, and project context.
- Codex CLI: the README uses a strong splash image and a short local-agent promise before the quickstart.
- Aider: the brand is workflow-first: repo map, git integration, lint/test loop, voice, images/web pages, and copy/paste handoff.
- Claude Code: the official docs position the product as an agentic terminal coding tool and emphasize project context, workflow commands, and safe collaboration inside the terminal.
- Charmbracelet/Bubble Tea/Lip Gloss: modern terminal apps can feel branded and polished without becoming noisy if the UI has strong layout, concise states, and terminal-native styling.

## Sanook Direction

Sanook should own a "service routes" identity:

- Code: `@file`, tools, diff, edit/run.
- Brain: second-brain context, remember/recall, skills, compression.
- Connect: MCP registry, gateway serve, webhooks.
- Ship: copy handoff, cost guard, final proof, undo safety.

This is more distinctive than only changing colors because it tells users what Sanook does for them in the first five seconds.

## 2026-06-19 Implementation Decision

Add a "startup cockpit" layer rather than only adding more ASCII art:

- Show live readiness signals: second-brain ready/missing, MCP server count, loaded skill count, and git branch.
- Keep the existing responsive tiers: wide wordmark, medium launchpad, tiny text-only fallback.
- Preserve the service-route identity so the banner reads as a promise of work: Code, Brain, Connect, Ship.
- Make the tagline more Sanook-specific: "งานหนักให้เบาลง · ไม่เบาความรับผิดชอบ · local-first memory".

Reason: other agent CLIs already have terminal-first branding, MCP/tooling, screenshots, or git-heavy workflows. Sanook's defensible difference is that it can make durable memory and extension readiness visible immediately.

up:: [[Research/_Index]]
