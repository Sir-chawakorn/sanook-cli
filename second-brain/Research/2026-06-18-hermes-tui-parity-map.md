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

ยังไม่ได้เอา Hermes TUI มาทั้งหมด. Sanook ตอนนี้เอาแนวคิด startup banner/status launchpad, startup service panel, slash/path completion float box, compact transcript tool trail, และ floating overlay path สำหรับ `/help` pager, `/hotkeys`, `/model` picker, `/mcp` hub พร้อม lazy server test, `/skills` hub, กับ `/sessions` switcher มาแล้ว แต่ Hermes TUI เป็นระบบใหญ่กว่า banner มาก: มี custom Ink runtime, gateway RPC, fullscreen alternate screen, virtual transcript, overlays, model/session/skills/plugins hubs, terminal selection/clipboard, mouse wheel acceleration, status rule, collapsible reasoning/tool trail, todo panel, markdown streaming, voice hooks, and skin/theme live repaint.

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
- Done: `/help` pager overlay in `src/ui/overlay.tsx`; supports line/page navigation, top/bottom jumps, and close on `Esc/q`.
- Done: slash-command and path completion float box in `src/ui/overlay.tsx` + `src/slash-completion.ts`; supports prefix filtering, `@file`/relative/home/absolute path tokens, row navigation, and Tab/Enter-to-complete before submit.
- Done: `/mcp` MCP Hub overlay in `src/ui/overlay.tsx` + `src/mcp-hub.ts`; maps Hermes plugins hub to Sanook's extension model by listing configured MCP servers, transport, target, secret summary, and lazy selected-server testing with `t` for PASS/FAIL plus advertised tool names.
- Done: floating `/hotkeys` overlay foundation in `src/ui/overlay.tsx`; closes with `Esc`, `Enter`, or `q`.
- Done: `/model` picker overlay in `src/ui/overlay.tsx` using Sanook provider registry; supports ↑/↓ or j/k and Enter-to-switch.
- Done: `/skills` read-only Skills Hub overlay in `src/ui/overlay.tsx` using Sanook's bundled/global/project skill loader; supports list navigation and inspect view.
- Done: `/sessions` Session Switcher overlay in `src/ui/overlay.tsx` using Sanook's saved session store; supports list navigation and Enter-to-resume for current-project sessions.
- Done: bounded queued-message window inspired by Hermes `QueuedMessages`, with active row selection and `Ctrl+X` deletion while busy.
- Done: Hermes-like Sanook status rule in `src/ui/status.ts` + cached git branch lookup in `src/ui/useGitBranch.ts` + busy elapsed timer in `src/ui/useBusyElapsed.ts`; prioritizes state/model/mode/context/queue, sheds lower-priority hints on narrow terminals, shows elapsed/cost/cwd/branch when space allows, and makes cwd/branch yield before wrapping.
- Done: compact transcript tool trail in `src/ui/tool-trail.ts` + `src/ui/app.tsx`; `tool-call` events render as running rows, `tool-result` events mark rows done, errors mark the latest running tool, completed trails are snapshotted into the assistant turn, and assistant streaming text no longer gets polluted by raw tool-call markers.
- Done: REPL banner only renders before conversation history exists, preserving scrollback.
- Done: simple approval prompt, prompt history, slash commands, `@file` mention expansion, model footer.
- Missing: fullscreen alternate screen and virtual transcript.
- Missing: richer plugin/MCP actions such as enable/disable and install from registry inside the TUI, plus richer session actions/live session state.
- Missing: richer background-task/voice/compression segments in the status rule.
- Missing: custom grapheme-safe TextInput and mouse selection/OSC52 clipboard.
- Missing: collapsible/interactive startup session sections for tools/skills/MCP/system.
- Missing: streaming markdown, collapsible reasoning+tool trail controls with richer grouping, and live todo panel parity.
- Missing: live theme/skin engine with user-defined banner art/colors.

## Port Plan

P0 completed:
- Responsive SANOOK AI Launchpad in `src/ui/banner.tsx`.

P1 next, low-risk/high-value:
- Upgrade startup service panel into collapsible/interactive sections using Sanook's existing `/tools`, skill loader, and MCP config.
- Expand the new floating overlay foundation into richer MCP/plugin actions, richer skill actions, and richer session actions.
- Expand status with background-task/voice/compression segments.

P2 completed:
- Paged `/help` overlay using Sanook command help text.
- Model picker overlay using Sanook provider registry.
- Session switcher overlay using Sanook saved sessions.
- Skills hub overlay using Sanook skill list/read surfaces.
- Compact transcript tool trail for `tool-call`/`tool-result`/`error` agent events.

P2 next:
- Add richer skill actions once Sanook has stable install/remove/open/edit surfaces.
- Add richer session actions: delete, rename/title edit, cross-project switch, and live-session metadata.
- Custom command completion and richer path edge cases (quoted paths, hidden files toggle, Windows drive polish).

P3 larger:
- Virtual transcript/scrollbar/sticky prompt.
- Rich message rendering with markdown, collapsible reasoning/tool trail controls, thinking, and todo panel.
- Custom text input with grapheme-safe cursor, paste collapse, and image/path drop detection.

P4 only if needed:
- Gateway-style RPC split between UI and backend. Sanook currently runs the agent in-process; copying Hermes' RPC architecture wholesale would be a larger framework change.

## Rebrand Rules

- Replace Hermes Agent -> SANOOK AI / Sanook.
- Replace Hermes mythological copy -> Sanook service promise: `plan -> patch -> prove -> remember`, `readable · recoverable · remembered`.
- Keep Sanook differentiators prominent: BYOK, local-first, second brain, MCP workflows, Thai-friendly copy.
- Avoid copying Hermes Python backend assumptions unless Sanook has the equivalent feature.

up:: [[Research/_Index]]
