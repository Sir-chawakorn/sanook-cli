---
tags: [research, cli, tui, hermes, sanook]
note_type: research
created: 2026-06-18
updated: 2026-06-18
parent: "[[Research/_Index]]"
source:
  - https://github.com/nousresearch/hermes-agent
  - https://github.com/nousresearch/hermes-agent/tree/main/ui-tui/src
  - https://github.com/nousresearch/hermes-agent/blob/main/ui-tui/src/components/branding.tsx
  - https://github.com/nousresearch/hermes-agent/blob/main/ui-tui/src/components/appChrome.tsx
  - https://github.com/nousresearch/hermes-agent/blob/main/ui-tui/src/components/appOverlays.tsx
  - https://github.com/nousresearch/hermes-agent/blob/main/ui-tui/src/components/textInput.tsx
  - https://github.com/nousresearch/hermes-agent/blob/main/LICENSE
---

# Hermes TUI Parity Map for Sanook

> Map Hermes Agent TUI features against Sanook's current UI so future port/rebrand work can be prioritized without losing source/license context.

Source inspected: `nousresearch/hermes-agent` at commit `646cd1b` (shallow clone on 2026-06-18). License is MIT; direct code copies require preserving the Nous Research copyright/license notice.

## Answer

ยังไม่ได้เอา Hermes TUI มาทั้งหมด. Sanook ตอนนี้เอาแนวคิด startup banner/status launchpad, startup service panel, และ floating overlay path สำหรับ `/hotkeys` มาแล้ว แต่ Hermes TUI เป็นระบบใหญ่กว่า banner มาก: มี custom Ink runtime, gateway RPC, fullscreen alternate screen, virtual transcript, overlays, model/session/skills/plugins hubs, terminal selection/clipboard, mouse wheel acceleration, status rule, tool trail, todo panel, markdown streaming, voice hooks, and skin/theme live repaint.

## Hermes TUI Inventory

- Runtime shell: `entry.tsx`, `app.tsx`, `app/useMainApp.ts`, `gatewayClient.ts`.
- Layout/chrome: `components/appLayout.tsx`, `components/appChrome.tsx`, `components/branding.tsx`.
- Banner/session intro: responsive ASCII logo, compact fallback, session panel, caduceus hero, collapsible Tools/Skills/MCP/System sections.
- Status rule: busy indicator styles, elapsed time, model, context meter, cost/duration/background task/voice/compression segments, cwd/branch truncation.
- Transcript: virtual history, sticky scroll, transcript scrollbar, message grouping, role gutter, long system collapse.
- Streaming: incremental markdown, reasoning/tool trail grouping, pending tools, live todo panel.
- Composer: custom text input, grapheme-safe cursor movement, multiline navigation, paste collapse, path/image drop detection, queue editing.
- Completions: slash completion and path completion float box.
- Overlays: approval, confirm, clarify, sudo password, secret prompt, pager, model picker, active session switcher, skills hub, plugins hub, agents overlay, FPS/perf overlays.
- Terminal integration: alternate screen, bracketed paste, mouse tracking, copy-on-select, OSC52 clipboard, terminal parity hints, Termux mode.
- Domain/libs: block layout, providers, usage, viewport, emoji/math unicode/syntax/text sanitization, memory monitor, subagent tree.
- Tests: broad UI regression suite for status rules, input cursor drift, terminal modes, overlays, markdown, virtual scroll, queue, theme, clipboard, and slash parity.

## Sanook Current Parity

- Done: big `SANOOK AI` wordmark and launchpad in `src/ui/banner.tsx`.
- Done: responsive banner tiers inspired by Hermes: wide wordmark, compact panel, tiny text-only panel.
- Done: startup service panel with Tools, Brain, Skills, MCP, System, and Runtime lanes in `src/ui/session-panel.tsx`.
- Done: `/hotkeys` command adapted from Hermes hotkey discovery.
- Done: floating `/hotkeys` overlay foundation in `src/ui/overlay.tsx`; closes with `Esc`, `Enter`, or `q`.
- Done: bounded queued-message window inspired by Hermes `QueuedMessages`.
- Done: responsive footer/status helper that sheds low-priority hints on narrow terminals.
- Done: REPL banner only renders before conversation history exists, preserving scrollback.
- Done: simple approval prompt, prompt history, basic queue, slash commands, `@file` mention expansion, model footer.
- Missing: fullscreen alternate screen and virtual transcript.
- Missing: full overlay system for model/session/skills/plugins and paged help.
- Missing: rich status rule with context/cost/cwd/branch progressive disclosure.
- Missing: custom grapheme-safe TextInput and mouse selection/OSC52 clipboard.
- Missing: collapsible/interactive startup session sections for tools/skills/MCP/system.
- Missing: streaming markdown/tool trail/todo panel parity.
- Missing: live theme/skin engine with user-defined banner art/colors.

## Port Plan

P0 completed:
- Responsive SANOOK AI Launchpad in `src/ui/banner.tsx`.

P1 next, low-risk/high-value:
- Upgrade startup service panel into collapsible/interactive sections using Sanook's existing `/tools`, skill loader, and MCP config.
- Expand the new floating overlay foundation into model picker, sessions switcher, skills hub, and paged help.
- Add queue editing/deletion hotkeys (`Ctrl+X`, active row) once Sanook's composer state can track queue edit index.
- Expand the footer/status helper into a Hermes-like status rule with context/cost/cwd/branch segments.

P2 next:
- Model picker overlay using Sanook provider registry.
- Session switcher overlay using Sanook saved sessions.
- Skills hub overlay using Sanook skill list/add/remove surfaces.
- Completion float box for slash commands and paths.

P3 larger:
- Virtual transcript/scrollbar/sticky prompt.
- Rich message rendering with markdown, tool trail, thinking, and todo panel.
- Custom text input with grapheme-safe cursor, paste collapse, and image/path drop detection.

P4 only if needed:
- Gateway-style RPC split between UI and backend. Sanook currently runs the agent in-process; copying Hermes' RPC architecture wholesale would be a larger framework change.

## Rebrand Rules

- Replace Hermes Agent -> SANOOK AI / Sanook.
- Replace Hermes mythological copy -> Sanook service promise: `plan -> patch -> prove -> remember`, `readable · recoverable · remembered`.
- Keep Sanook differentiators prominent: BYOK, local-first, second brain, MCP workflows, Thai-friendly copy.
- Avoid copying Hermes Python backend assumptions unless Sanook has the equivalent feature.

up:: [[Research/_Index]]
