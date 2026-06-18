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
  - https://clig.dev/
  - https://github.com/google-gemini/gemini-cli
  - https://github.com/openai/codex
  - https://github.com/Aider-AI/aider
---

# Hermes TUI Parity Map for Sanook

> Map Hermes Agent TUI features against Sanook's current UI so future port/rebrand work can be prioritized without losing source/license context.

Source inspected: `nousresearch/hermes-agent` at commit `646cd1b`, then rechecked against GitHub HEAD `c37fdec` (`feat(dashboard): surface full per-MCP catalog detail; fix pip-install doc`) and latest HEAD `2fa16ec` (`Merge pull request #48529 from kshitijk4poor/salvage-48372-eap`) on 2026-06-18. License is MIT; direct code copies require preserving the Nous Research copyright/license notice.

## Answer

ยังไม่ได้เอา Hermes TUI มาทั้งหมด. Sanook ตอนนี้เอาแนวคิด startup banner/status launchpad, startup service routes panel, slash/path completion float box, compact/expanded transcript tool trail controls, Hermes-style `/details` สำหรับ thinking/tools sections, streaming markdown renderer แบบ stable-prefix/tail, grapheme-safe prompt cursor/backspace, Hermes-style long paste collapse, `/copy` clipboard/OSC52 bridge, และ floating overlay path สำหรับ `/help` pager, `/hotkeys`, `/tools` hub, `/model` picker, `/mcp` hub พร้อม lazy server test + per-server tool catalog browsing, `/skills` hub, กับ `/sessions` switcher ที่ inspect/resume/delete-confirm ได้มาแล้ว แต่ Hermes TUI เป็นระบบใหญ่กว่า banner มาก: มี custom Ink runtime, gateway RPC, fullscreen alternate screen, virtual transcript, overlays, model/session/skills/plugins hubs, terminal selection/copy-on-select, mouse wheel acceleration, richer collapsible reasoning/tool trail, todo panel, richer markdown/math/table rendering, voice hooks, and skin/theme live repaint.

## Outside CLI Notes

- CLIG.dev emphasizes human-first design, "just enough" output, discoverability, and conversational feedback. Sanook should make the first screen explain useful next actions without becoming scrollback noise.
- Gemini CLI presents a clear screenshot-led identity and foregrounds built-in tools, MCP extensibility, terminal-first use, checkpointing, and project context files.
- OpenAI Codex uses a strong splash image plus a direct local-agent promise and very short quickstart path.
- Aider differentiates less through TUI chrome and more through workflow promises: repo map, git integration, lint/test loops, voice, image/web context, and copy/paste handoff.
- Sanook's best brand gap is therefore not a bigger logo; it is a memorable terminal service map: Code, Brain, Connect, Ship.

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
- Done: startup service routes panel with Code, Brain, Connect, Ship, System, and Runtime lanes in `src/ui/session-panel.tsx`.
- Done: `/hotkeys` command adapted from Hermes hotkey discovery.
- Done: `/help` pager overlay in `src/ui/overlay.tsx`; supports line/page navigation, top/bottom jumps, and close on `Esc/q`.
- Done: slash-command and path completion float box in `src/ui/overlay.tsx` + `src/slash-completion.ts`; supports prefix filtering, `@file`/relative/home/absolute path tokens, row navigation, and Tab/Enter-to-complete before submit.
- Done: `/mcp` MCP Hub overlay in `src/ui/overlay.tsx` + `src/mcp-hub.ts`; maps Hermes plugins hub/dashboard catalog idea to Sanook's extension model by listing configured MCP servers, transport, target, secret summary, lazy selected-server testing with `t` for PASS/FAIL, and per-server advertised tool catalog browsing with ↑/↓ or j/k.
- Done: floating `/hotkeys` overlay foundation in `src/ui/overlay.tsx`; closes with `Esc`, `Enter`, or `q`.
- Done: `/tools` Tools Hub overlay in `src/ui/overlay.tsx` + `src/tool-catalog.ts`; lists built-in file/git/memory/schedule/sub-agent/diagnostics lanes and supports Enter-to-inspect details instead of dumping a long text block into scrollback.
- Done: `/model` picker overlay in `src/ui/overlay.tsx` using Sanook provider registry; supports ↑/↓ or j/k and Enter-to-switch.
- Done: `/skills` read-only Skills Hub overlay in `src/ui/overlay.tsx` using Sanook's bundled/global/project skill loader; supports list navigation and inspect view.
- Done: `/sessions` Session Switcher overlay in `src/ui/overlay.tsx` using Sanook's saved session store; supports list navigation, Enter-to-resume for current-project sessions, `i` detail inspect, and two-press `d` delete confirmation.
- Done: bounded queued-message window inspired by Hermes `QueuedMessages`, with active row selection and `Ctrl+X` deletion while busy.
- Done: Hermes-like Sanook status rule in `src/ui/status.ts` + cached git branch lookup in `src/ui/useGitBranch.ts` + busy elapsed timer in `src/ui/useBusyElapsed.ts`; prioritizes state/model/mode/context/queue, sheds lower-priority hints on narrow terminals, shows elapsed/context-compression/cost/cwd/branch when space allows, and makes cwd/branch yield before wrapping.
- Done: compact/expanded transcript tool trail controls in `src/ui/tool-trail.ts` + `src/ui/app.tsx`; `tool-call` events render as running rows, `tool-result` events mark rows done, errors mark the latest running tool, completed trails are snapshotted into the assistant turn, `/trail [compact|expanded]` and `Ctrl+T` rerender saved transcript trails, and assistant streaming text no longer gets polluted by raw tool-call markers.
- Done: `/details thinking hidden|collapsed|expanded` and `/details tools hidden|collapsed|expanded` in `src/commands.ts` + `src/ui/thinking-panel.ts` + `src/ui/app.tsx`; maps Hermes section visibility to Sanook's capped reasoning panel and tool trail visibility.
- Done: streaming/saved assistant markdown rendering in `src/ui/markdown.tsx` + `src/ui/app.tsx`; supports headings, quotes, lists, fenced code, inline code, bold, and a Hermes-inspired stable-prefix/unstable-tail split outside code fences.
- Done: grapheme-safe prompt cursor/backspace in `src/ui/useEditor.ts`; left/right/delete move across Thai combining marks, emoji, and ZWJ emoji as whole grapheme clusters.
- Done: Hermes-style long paste collapse in `src/ui/useEditor.ts` + `src/ui/app.tsx`; bracketed/multiline paste normalizes newlines, collapses long payloads into readable `[[ paste ... ]]` tokens, and expands those snippets before submit so the model receives full text.
- Done: `/copy [last]` clipboard bridge in `src/clipboard.ts` + `src/ui/app.tsx`; copies the latest assistant response via native system clipboard tools and falls back to OSC52 terminal clipboard sequences.
- Done: REPL banner only renders before conversation history exists, preserving scrollback.
- Done: simple approval prompt, prompt history, slash commands, `@file` mention expansion, model footer.
- Missing: fullscreen alternate screen and virtual transcript.
- Missing: richer plugin/MCP actions such as enable/disable and install from registry inside the TUI, schema-level tool detail panes, plus remaining session actions such as rename/cross-project switch/live session state.
- Missing: richer background-task and voice segments in the status rule.
- Missing: remaining full custom TextInput/terminal parity: visual wrap cursor layout, image/path drop detection, mouse selection, and copy-on-select.
- Missing: collapsible/interactive startup session sections for tools/skills/MCP/system.
- Missing: richer grouped reasoning trail, live todo panel parity, and full markdown/math/table/media parity.
- Missing: live theme/skin engine with user-defined banner art/colors.

## Port Plan

P0 completed:
- Responsive SANOOK AI Launchpad in `src/ui/banner.tsx`.

P1 next, low-risk/high-value:
- Upgrade startup service panel into collapsible/interactive sections using Sanook's Tools Hub, skill loader, and MCP config.
- Expand the new floating overlay foundation into richer tools/MCP/plugin actions, richer skill actions, and richer session actions.
- Expand status with background-task/voice/compression segments.

P2 completed:
- Paged `/help` overlay using Sanook command help text.
- Tools Hub overlay using Sanook built-in tool catalog.
- Model picker overlay using Sanook provider registry.
- Session switcher overlay using Sanook saved sessions.
- Skills hub overlay using Sanook skill list/read surfaces.
- Compact/expanded transcript tool trail controls for `tool-call`/`tool-result`/`error` agent events.
- `/details thinking/tools hidden|collapsed|expanded` section controls with a capped thinking panel and hidden/compact/expanded tool trail.
- Streaming markdown renderer for live assistant output and saved assistant turns.
- Grapheme-safe prompt cursor/backspace for Thai combining marks, emoji, and ZWJ emoji.
- Long paste collapse with snippet expansion before submit.
- `/copy [last]` clipboard bridge with native clipboard + OSC52 fallback.

P2 next:
- Add richer skill actions once Sanook has stable install/remove/open/edit surfaces.
- Add remaining richer session actions: rename/title edit, cross-project switch, and live-session metadata.
- Custom command completion and richer path edge cases (quoted paths, hidden files toggle, Windows drive polish).

P3 larger:
- Virtual transcript/scrollbar/sticky prompt.
- Full rich message rendering with markdown math/tables/media, richer grouped reasoning trail, and todo panel.
- Finish remaining custom text input/terminal parity: visual wrap cursor layout, image/path drop detection, mouse selection, and copy-on-select.

P4 only if needed:
- Gateway-style RPC split between UI and backend. Sanook currently runs the agent in-process; copying Hermes' RPC architecture wholesale would be a larger framework change.

## Rebrand Rules

- Replace Hermes Agent -> SANOOK AI / Sanook.
- Replace Hermes mythological copy -> Sanook service promise: `plan -> patch -> prove -> remember`, `readable · recoverable · remembered`.
- Keep Sanook differentiators prominent: BYOK, local-first, second brain, MCP workflows, Thai-friendly copy.
- Avoid copying Hermes Python backend assumptions unless Sanook has the equivalent feature.

up:: [[Research/_Index]]
