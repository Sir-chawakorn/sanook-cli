# Changelog

## 0.5.8

### Self-maintaining memory + reliability & security hardening

**New: automatic memory maintenance** (default on; `sanook config set autoMaintain off` / `SANOOK_DISABLE_AUTO_MAINTAIN=1` to disable)

- **Auto-consolidate** — on REPL startup (at most once a week) the second brain consolidates itself: dedup memory, archive stale notes by importance decay (reversible — never deletes), refresh the index. Background, non-blocking.
- **Auto-distill** — on session exit (and each headless turn) durable facts from the conversation are distilled into the compounding memory store so the self-retrieving brain surfaces them next time (previously opt-in via `SANOOK_AUTO_DISTILL`).
- Status shown in `sanook config`.

**Vault data-integrity fixes** (second brain)

- Worklog/transcript/index writers no longer truncate history when pasted content contains an `up::` line — the footer regex now matches only the trailing footer.
- `$`-sequences in prompts/answers/titles/paths no longer corrupt vault notes (String.replace replacement-pattern injection) — fixed across every note/index writer.
- Worklog writes are serialized (lost-update under back-to-back turns); chat-transcript headings use the real per-turn time (were frozen to session start, and mis-filed past midnight).

**Persona** (`sanook persona`)

- `sanook persona <bad-arg>` errors with an unknown-subcommand message instead of falling through to a paid LLM call.
- Re-running with identical answers no longer claims facts were newly saved; Esc-back no longer overwrites a prior answer (including a custom "อื่นๆ" value); warns when the vault profile note can't be written.

**REPL / terminal**

- Detailed live activity: the busy status line shows the friendly action ("📖 อ่านไฟล์ …", "`$ npm test`") instead of the raw tool name; expanded tool-trail height is bounded so big diffs can't push the prompt off-screen; scrollback renders past turns compact.

**Dashboard**

- Security: fixed directory traversal in the file API (path confinement now uses a real path boundary, not a string prefix).
- Web terminal: the agent run is cancelled when the browser disconnects; the raw-shell websocket is guarded against uncaught-error crashes.

**Installer**

- `install.ps1` checks the install exit code — no more false "Sanook CLI installed" banner when `npm install -g` fails.

## 0.5.7

### Local token usage ledger (ccusage-style)

- **Persistent usage tracking** — every agent turn appends to `~/.sanook/usage/events.jsonl` with input/output/cache tokens, estimated cost, model, session id, and source (`repl`, `headless`, `gateway`, `subagent`, `plan`).
- **`sanook usage`** — daily / weekly / monthly / session reports with ASCII tables and `--json` export (similar to [ccusage](https://ccusage.com/guide/getting-started)).
- **Codex usage capture** — parse `turn.completed` token counts from Codex JSONL into the ledger.
- **`/cost` / `/usage`** in REPL now points to `sanook usage daily` for full history.
- Disable with `SANOOK_DISABLE_USAGE=1`.

## 0.5.6

### Install UX, second-brain wiring, session save, terminal visibility, Codex models

- **`sanookai` CLI alias** — backward-compatible binary name alongside `sanook` (fixes Windows "sanookai not recognized" when docs/videos use the old name).
- **Postinstall hints** — clarify global vs local install; suggest `npx sanook` / `npx sanookai` when not on PATH.
- **Second-brain project link** — after setup brain wizard, auto-scaffold `Projects/<slug>/` for the current repo and create/link `SANOOK.md` project memory.
- **Session save on exit** — Ctrl+C (empty prompt) or `/quit` saves the REPL session and writes a summarized note to `Sessions/` in the vault.
- **Live agent status** — REPL shows Codex/Agent/Tool/Thinking status while work is in progress.
- **Codex model picker** — delegate provider lists current Codex models (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, legacy codex variants, spark).

## 0.5.5

### Hermes-style setup, dashboard, and terminal parity

- **Localized setup wizard (EN/TH)** — language picker on first run; steps for provider, model, **agent** (permission mode), **tools**, **gateway**, second brain, and complete (~10 steps).
- **`sanook dashboard`** — local web UI on port 9119 with pages: Home, **Chat**, Models, Sessions, **Files**, **Logs**, **Cron**, **Channels**, Config, MCP, Brain; REST APIs for status, config, files, logs, cron, and channels.
- **Two-phase `/model` picker** — choose provider, then model (Hermes-style); `Esc` returns to provider list.
- **New slash commands** — `/setup` (setup section hints), `/dashboard` (open web dashboard).
- **Codex device-code login** — Hermes-style OAuth device flow in setup wizard (`src/providers/codex-login.ts`).
- **i18n foundation** — `src/i18n/` with English and Thai strings; locale persisted in global config.

## 0.5.4

### Multi-project vault — project workspace auto-detect

- **`Projects/<slug>/` workspace standard** — `overview.md`, `current-state.md`, `context.md`, `repo.md` with `repo_path` for machine-readable repo mapping.
- **`sanook brain new project --title "..." --repo /path`** — scaffolds full `Projects/<slug>/` workspace from `Templates/project-workspace/` and links it from `Projects/_Index.md`.
- **`sanook brain projects list`** — shows registered project workspaces and marks the active project for the current cwd.
- **Project auto-detect in agent context** — when cwd is inside a project's `repo_path`, Sanook injects `<project_workspace>` hot context (current-state, context, overview) into `loadBrainContext()` and `sanook brain context`.
- **`sanook brain context --project <slug>`** — force a project workspace without cwd matching.
- **Scaffold policy** — `sanook brain init` no longer copies bundled `Projects/<slug>/` dogfood folders into new vaults (only `Projects/_Index.md`); add projects explicitly with `brain new project`.

## 0.5.3

### Second-brain CLI — pack, create, repair, consolidate, metrics

- **`sanook brain pack list|show <name>`** — makes `Shared/Context-Packs/` first-class: list packs with descriptions and index status; show load order, done criteria, and wiki-link sources.
- **`sanook brain new <type> [--title "..."]`** — template-backed note creation for `session`, `bug`, `handoff`, `project`, `golden-case`, and `checklist`; fills frontmatter, sets `parent`/`up::`, appends to destination `_Index.md`, and rejects wrong-folder output paths.
- **`sanook brain repair [--dry-run]`** — safe one-line fixes after `doctor`/`review`: missing purpose blockquote, `parent`, `up::`, unlinked context packs, and missing scaffold folders.
- **`sanook brain consolidate [--apply] [--apply --archive] [--memory]`** — sleep-time consolidation runner (inbox dedup, stale → archive, retrieval eval, optional auto-memory merge); dry-run by default.
- **`sanook brain metrics [--no-retrieval]`** — vault counts, stale notes, index freshness, and retrieval coverage with non-zero exit on issues.
- **Context pack auto-select** — `buildBrainContext({ taskQuery })` and per-turn retrieval now inject the best-matching context pack before broader vault context.

### MCP trust & safety

- **`sanook mcp enable|disable <name>`** — toggle MCP servers without removing config (`enabled` flag in `mcp.json`; disabled servers are skipped by the agent, web probes, and doctor).
- **401 auth hints** — `mcp test` / `mcp doctor` print setup hints when hosted remotes return Unauthorized.
- **Risk labels** — classify servers as `read-only`, `file-write`, `network-write`, `database-write`, or `infra/admin` in search/info/list/test and the MCP hub overlay.
- **Registry cache** — official MCP registry responses are cached for 5 minutes to reduce repeated network fetches.

### Agent loop — web fetch, plan handoff, background tasks

- **`web_fetch` agent tool** — built-in ethical fetch ladder (direct HTML → reader → Tavily → Wayback); read-only, no approval gate; same policy as `sanook web fetch`.
- **`sanook plan "<task>"`** — read-only plan mode with stderr execute handoff (`sanook --yes "…"`) after success.
- **`/tasks` overlay + `bg N` status** — inspect running `task_spawn` background jobs from the REPL.

### Gateway — doctor, richer status, mobile replies

- **`sanook gateway doctor`** — validate configured channel tokens, webhooks, and allowlists with live probes where possible.
- **`sanook gateway status` (enhanced)** — pending cron jobs, recent delivery failures, and config-based channel health summary.
- **Mobile chat formatting** — truncate fenced code blocks and cap reply length before delivering to Telegram/Discord/Slack/LINE/WhatsApp and other chat platforms.

### TUI — sessions, transcript, launchpad

- **Session rename** — `/sessions` → `r` to rename inline.
- **Cross-project sessions** — list sessions from all projects (`≠` marker); resume cross-project with `--continue-any`-style cwd note.
- **Virtual transcript** — viewport windowing with PgUp/PgDn scroll instead of rendering full scrollback.
- **Collapsible launchpad** — keys `1`/`2`/`3` toggle Tools/Skills/MCP startup sections.

### Developer experience

- **`sanook init [--trust]`** — scaffold `.sanook/commands/` starter templates and print brain/MCP/trust next-step hints.
- **`sanook skill install <name|path>`** — install from bundled catalog or local path (shared resolver with `skill add`).

## 0.5.2

### TUI startup polish — SANOOK AI Launchpad

- **Live startup cockpit signals** — the Sanook launchpad now shows real local readiness, not just brand copy: second-brain configured/missing, MCP server count, loaded skill count, and current git branch. This turns the first screen into a useful service cockpit for Code, Brain, Connect, and Ship workflows, while keeping medium/tiny terminal fallbacks readable.
- **Big `SANOOK AI` startup banner** — the REPL now opens with a large gradient wordmark plus a compact launchpad for version, account mode, live model, automation mode, cwd, and high-signal slash-command hints. The banner now carries the Sanook identity directly (`งานหนักให้เบาลง · ไม่เบาความรับผิดชอบ · local-first memory`), a signature workflow (`plan -> patch -> prove -> remember`), and a service promise (`readable · recoverable · remembered`). It gives users four memorable service routes: Code (`@file`, tools, diff), Brain (`brain context`, skills, compression), Connect (`MCP`, gateway, webhooks), and Ship (`copy`, cost guard, undo). Hermes-style responsive tiers keep it usable across terminal widths: wide wordmark, compact panel, and tiny text-only fallback. It still renders only before conversation history exists, so command turns do not redraw it into terminal scrollback.
- **Startup service routes panel** — the empty REPL now also shows a Hermes-style Sanook service-routes panel with Code, Brain, Connect, Ship, System, and Runtime lanes. It tells new users what the CLI can do immediately: edit/run/read tools, second-brain context and worklogs, reusable skills, MCP registry/install/doctor/serve, gateway/webhook work, `/copy` handoff, ask-mode approvals, queued follow-ups, and `/hotkeys`. The panel has compact copy for medium terminals and hides on tiny terminals so the prompt stays usable.
- **Floating overlay foundation** — `/help` now opens a Hermes-style paged overlay with line/page navigation instead of dumping the full command reference into scrollback. Typing slash-command prefixes or path-like tokens such as `@src/foo`, `./src/`, `~/notes/`, or `/tmp/` now shows a Hermes-style completion float box with command/file metadata; ↑/↓ chooses a row and Tab/Enter completes before the command or prompt is submitted. `/tools` opens a Sanook Tools Hub overlay for built-in file/git/memory/schedule/sub-agent/diagnostics lanes, while `/mcp` opens a Sanook MCP Hub overlay, mapping Hermes' plugins hub idea onto Sanook's extension surface: configured MCP servers, stdio/http transport, target, secret summary, and lazy selected-server testing with `t` so users can see PASS/FAIL and browse the selected server's advertised tool catalog with ↑/↓ or j/k before leaving the REPL. `/hotkeys` opens a dismissible TUI overlay (`Esc`, `Enter`, or `q`). `/model` without args opens an interactive model picker overlay with ↑/↓ or j/k navigation and Enter-to-switch, while `/model <spec>` keeps the existing direct canonical switch behavior. `/skills` opens a read-only Skills Hub overlay for browsing loaded skills and inspecting description/path metadata. `/sessions` opens a Hermes-style Session Switcher for saved sessions in the current project, resumes the highlighted session with Enter, inspects session metadata with `i`, and deletes with a two-press `d` confirmation. This is the reusable Sanook overlay path for the remaining richer help/session surfaces.
- **Hermes-inspired REPL affordances** — added `/hotkeys`, a bounded queued-message window (`queued (n)` + `…and N more`) with an active row plus `Ctrl+X` deletion while busy, a Sanook tool trail for `tool-call`/`tool-result` events that persists into the assistant transcript after the turn completes and can be toggled with `/trail [compact|expanded]` or `Ctrl+T`, and a Sanook status rule that prioritizes state/model/mode/context/queue over secondary hints, shows elapsed time while working, shows context-compression mode (`cmp sel/hdr/off`) on roomy terminals, shows cost plus cwd/branch on wider terminals, and lets the cwd/branch segment yield before it can wrap or crowd the important left side.
- **Hermes-style details controls** — `/details thinking hidden|collapsed|expanded` now controls a capped Sanook thinking panel fed by provider reasoning deltas, and `/details tools hidden|collapsed|expanded` maps Hermes' tools section visibility onto Sanook's persisted tool trail (`hidden`, compact/collapsed, expanded). This gives users a cleaner way to tune how much live agent work is visible without losing the quick `/trail` toggle.
- **Streaming markdown rendering** — assistant live output and saved assistant turns now render common Markdown blocks instead of raw text: headings, block quotes, bullet/numbered lists, fenced code blocks, inline code, and bold spans. The live renderer keeps a Hermes-inspired stable-prefix/unstable-tail split at blank-line boundaries outside code fences, so streaming fenced code and partially-written paragraphs stay readable without pulling in a heavyweight renderer.
- **Grapheme-safe prompt editing** — the REPL editor now moves the cursor and backspaces by grapheme cluster instead of raw JavaScript code unit. Thai combining marks, emoji, and ZWJ emoji stay intact while editing, matching the direction of Hermes' custom TextInput correctness work without importing its runtime.
- **Hermes-style paste collapse** — bracketed or multiline paste now normalizes CRLF/newlines and collapses long pasted text (5+ lines or 2k+ chars) into a readable `[[ paste ... ]]` token in the composer. On submit Sanook expands the token back to the original pasted text before running the agent, so the terminal stays readable while the model still receives the full context.
- **Terminal clipboard bridge** — `/copy [last]` copies the latest assistant response from the REPL. Sanook first tries the native system clipboard (`pbcopy`, PowerShell, `wl-copy`, `xclip`, `xsel`) and falls back to OSC52 terminal clipboard sequences when native tools are unavailable, covering the practical core of Hermes' clipboard work while leaving full mouse-selection parity for later.
- **Hermes TUI parity map** — added `second-brain/Research/2026-06-18-hermes-tui-parity-map.md` so the remaining rebrand/port work is explicit: overlays, model/session/skills hubs, status rule, virtual transcript, terminal clipboard/mouse support, streaming markdown/persistent tool trails, and skin/theme parity.

### Token reduction — selective context compression for stale tool output

- **`sanook prompt-size [--json]`** — Hermes-inspired offline prompt budget diagnostic. It reports the current system prompt, personality overlay, auto-memory, skills index, second-brain context, project memory, repo map, git context, built-in tool schemas, and total rough token/byte footprint without calling a model or spawning MCP servers, so users can tune large second-brain/skill setups before context cost becomes invisible.
- **`contextCompression: "selective" | "headroom" | "off"`** (env `SANOOK_CONTEXT_COMPRESSION`) — default `"selective"` is a zero-LLM, per-step compressor inspired by Selective Context, LongLLMLingua-style query awareness, and Headroom-style context pruning. It keeps the latest tool results full, but compresses older huge tool outputs with recency-aware budgets and preserves anchors plus high-information lines (current-query matches, errors, paths, diffs, code structure, rare terms) before the next model request. `"headroom"` optionally wraps the Vercel AI SDK model with the `headroom-ai` GitHub/npm framework when a Headroom proxy/cloud setup is available; `"off"` disables compression.

### Polyglot runtime foundation — Python/Rust without mandatory native deps

- **`sanook runtimes [--json]`** — new runtime surface report for Sanook's language strategy. TypeScript remains the npm-distributed control plane; Python is the optional analysis/data/document/ML helper plane; Rust is the optional performance/safety/native-helper plane. The command detects Python, uv, rustc, Cargo, Pyright, and rust-analyzer, then prints install hints without making any of them required for basic Sanook usage.
- **`run_python` / `run_rust` agent tools** — approval-gated, no-shell runtime tools. `run_python` runs a Python snippet or workspace `.py` file for JSON/CSV transforms, document/text parsing, OCR/ML glue, and research scripts. `run_rust` compiles and runs a single-file Rust snippet or workspace `.rs` file for fast parsers/checkers and type-safe native-helper prototypes. Missing runtimes degrade to clear install messages instead of breaking the agent loop.

### Web grounding — true search readiness and source policy

- **`sanook web status [--json]` / `sanook web doctor [--json]`** — new diagnostic surface for true web/search/fetch readiness. It clearly separates `sanook search` local retrieval (vault, memory, sessions, skills) from internet search through MCP servers, detects configured web/search/fetch candidates, and optionally probes advertised tools. The report also prints the recommended `research` MCP preset and Sanook's grounding policy.
- **Agent web-use policy** — the system prompt now tells the agent to use configured web/search/fetch MCP tools for current or volatile external facts, prefer primary sources for technical work, cite source URLs/titles, and treat fetched/search content as untrusted data rather than instructions.

### MCP registry UX — discover, install, and diagnose servers

- **`sanook mcp search/info/install`** — browse the official MCP registry, inspect transports/packages/secret requirements, and write a ready-to-use stdio or Streamable-HTTP config into `~/.sanook/mcp.json` (or trusted project config with `--project`).
- **`sanook mcp test` / `sanook mcp doctor` / `sanook mcp list --tools`** — probe configured MCP servers, show advertised tools, and fail clearly when a server is missing credentials, unreachable, or misconfigured.
- **`sanook mcp preset`** — curated starter bundles (`dev`, `research`, `pm`, `ops`) for common Sanook workflows.

### Second-brain CLI tooling — doctor, context, eval

- **`sanook brain context [--task "..."]`** — shows the exact `<brain_vault>` context Sanook injects from `Shared/AI-Context-Index.md`, `current-state.md`, and Memory-Inbox, with source char counts and stale/missing index warnings. With `--task`, it also runs focused retrieval over vault/session/skill hits.
- **`sanook brain eval`** — turns `Evals/second-brain-benchmarks.md` into a lightweight runner: static vault sanity checks, context-size/missing-source checks, index freshness, and retrieval probes for key rules/ledgers.
- **`sanook brain review`** — curator-style vault review for Memory-Inbox duplicates/possible contradictions, stale or incomplete context packs, session notes missing from the search manifest, eval freshness after framework changes, and markdown routing hygiene.
- **`sanook brain final [--task "..."] [--from-diff] [--lite]`** — creates an evidence-backed final gate note in `Sessions/`, optionally prefilled from the current git diff, and links it from `Sessions/_Index.md`. `brain review` now validates final gates for missing evidence/TODO placeholders, while `brain eval` keeps the full and lite templates covered.
- **Context assembly is inspectable without drift**: `buildBrainContext()` now exposes typed source parts and renders from the same parts used by the agent prompt.
- **Fresh scaffold discoverability**: generated `Shared/Context-Packs/_Index.md` now links the bundled context packs, so review/search can find them immediately.

### Whole-codebase audit — confirmed bugs fixed across the CLI

A multi-agent review swept every subsystem (agent loop, tools, providers, gateway, MCP, search, orchestration) and adversarially verified each finding. The ones fixed here:

**High**
- **`edit_file` silently stripped indentation.** The whitespace-flexible match tier matched an indented block by trimmed lines but spliced the (un-indented) replacement verbatim — de-indenting code and breaking Python/YAML, invisibly. It now re-applies the file's indentation to the replacement.
- **Codex delegate could never edit files + ran in the wrong directory.** `sanook -m codex` ran with `--sandbox read-only` unconditionally (a "coding agent" that silently couldn't write) and ignored worktree `cwd`. It now uses `workspace-write` in auto mode (read-only under plan/ask), threads `cwd`, and passes prior conversation so REPL turns aren't contextless.
- **Worktree rollback could lose a renamed file.** The pre-apply snapshot only captured destination paths, so a failed 3-way apply of a rename didn't restore the deleted source. Snapshots now cover both sides of renames/copies (and parse git-quoted paths).

**Medium** — git tools now run in the sub-agent's worktree (`git_commit --addAll` no longer commits the main repo); LSP child process no longer leaks on init failure/timeout (+ init timeout, + Windows `.cmd` shell, + Windows-critical env); Codex no longer crashes the CLI on an EPIPE; the model-fallback path no longer duplicates streamed output; MCP server stderr is drained (was hanging when the pipe filled); an untrusted project can no longer disable the budget cap or spoof pricing; the Telegram bot skips its backlog on startup (no replaying old commands); hooks get Windows-critical env.

**Low** — `replace_all` reports the real replacement count; the multi-match hint no longer suggests `replace_all` for flex matches (dead-end); a malformed trusted-project `hooks.json` no longer crashes the run; frontmatter-only notes with no trailing newline no longer leak the frontmatter into the indexed body; the gateway returns 400/413 (not 500) for bad/oversized request bodies.

**Follow-up medium fixes** — `sanook index` now builds and saves the semantic vector sidecar, so `--mode semantic|hybrid` no longer silently degrades to BM25 after a reindex; subagent fan-out has a global process-wide concurrency cap; `budgetUsd` is shared across the whole agent tree instead of resetting per subagent; isolated write subagents no longer inherit the interactive approval loop inside their temp worktree after the parent approved `task_parallel`; `/v1/chat/completions` now supports OpenAI-style `stream:true` SSE chunks.

**Follow-up low fixes** — protected path checks resolve symlink ancestors before allowing writes; search chunk ids use a stronger SHA-256-derived path hash; oversized MCP tool text is capped before entering model context; malformed search manifests are sanitized on load without discarding a valid index; a setup-wizard timing test now waits for the rendered validation frame instead of flaking under full-suite load.

### Fix: couldn't type in the REPL after first-run setup

The setup wizard and the REPL were two separate Ink renders (`render(SetupWizard)` → `unmount` → `render(App)`). After the first Ink instance unmounted, stdin raw-mode/keypress handling didn't reattach to the second, so the chat input was dead — you couldn't type anything. Now the wizard, the brain wizard, and the REPL live under **one Ink render** (a `Root` component swaps screens), so stdin stays continuous and input works the moment the REPL appears. (Regression-tested with ink-testing-library: typed characters reach the input box; phase routing verified.)

### Setup/first-run audit — 8 bugs found by adversarial review, all fixed

A multi-agent review of the first-run + setup + REPL flow surfaced (and independently verified) eight real, user-facing bugs — now fixed and regression-tested:

- **Empty API key silently completed setup.** `@inkjs/ui` PasswordInput fires `onSubmit` on Enter even when empty, so pressing Enter on a blank key advanced the wizard, finished, and saved *no key* — the first message then failed with "no API key" and no way back. The key step now rejects an empty submit (stays put, shows an inline error).
- **Wizard accepted OAuth/malformed keys it explicitly warned against.** The key step now runs the same `assertDirectApiKey` policy the runtime uses — paste a `sk-ant-oat…` subscription token and it's rejected *at the input* with a clear message, instead of being saved and blowing up later.
- **No way back from the key/model steps.** Picking the wrong provider dead-ended you into typing a key for the wrong service (Ctrl+C was the only escape). **Esc now returns to provider selection** from any step.
- **First-run env-detect trusted banned tokens.** An exported OAuth token (`ANTHROPIC_API_KEY=sk-ant-oat…`) made sanook print "✅ ready" and skip the wizard, then error on every message. `detectEnvProvider` now validates the key against policy (new `hasUsableEnvKey`) and falls through to the wizard when it's unusable.
- **First-run ignored an explicit `-m` flag.** `sanook -m groq` on a machine with only `OPENAI_API_KEY` printed "OpenAI ready" and ran a keyless Groq session. First-run now keys off the `-m` provider when given.
- **Codex auth step could wedge.** `detectCodex` had no timeout, so a hung `codex` binary left the step with no way forward. Added a 5s timeout (+ Esc always backs out).
- **Brain wizard name fields were pre-filled with the literal default** (`Owner` / `ผู้ช่วย`), so typing a custom name produced `OwnerPick`. Switched to a placeholder so the field starts empty (Enter still accepts the default).
- **Banner showed a stale model after `/model`.** It now tracks the live model.

### Fix: duplicate / empty model choices in the setup wizard

`mergeModelOptions` only deduped *remote* model ids against the curated list — never the curated list against itself. So aliases pointing at the same id rendered as **two identical-looking choices** (e.g. `haiku — claude-haiku-4-5` and `fast — claude-haiku-4-5`; OpenAI's `smart`/`gpt` both → `gpt-5.5`), which also collided on React keys (`Encountered two children with the same key` → options could duplicate or vanish). It now groups by model id and merges the alias names into one option (`haiku / fast — claude-haiku-4-5`). Separately, the old code dropped the `default` alias entirely, which **emptied the model list for LM Studio** (`{ default: 'local-model' }`) and hid Ollama's default model — those models are now selectable again. Locked in with tests (every provider yields unique option values; LM Studio/Ollama are non-empty).

### CLI audit follow-ups

- **`--continue-any` actually works as a resume flag now.** The headless arg parser forgot to consume it, so `sanook --continue-any` became a literal prompt instead of opening the REPL with the latest cross-project session. The parser is now split into a tested module and consumes all resume/headless aliases.
- **Search flags are validated.** `sanook search q --mode nope` used to silently fall back to FTS, and `--limit -5` could produce odd slice behavior. Search args now reject invalid modes, sources, missing queries, and non-positive limits with a clear usage line.
- **`sanook serve --port` missing values now report a human-readable error.** Empty or missing port values now surface `ต้องระบุค่า` instead of leaking `"undefined"` into the validation message.
- **`SANOOK_DISABLE_PERSISTENCE=1` now includes second-brain worklogs.** Sessions, auto-memory, prompt history, and worklogs all honor the global persistence kill switch; `SANOOK_DISABLE_WORKLOG=1` remains available for worklog-only opt-out.
- **First-run Codex readiness is real.** `sanook -m codex` no longer skips setup just because Codex does not use an API key; it only skips when the official `codex` CLI is installed and logged in.
- **Existing broken model config now reopens setup instead of entering a dead REPL.** If `~/.sanook/config.json` points at OpenAI without a usable key (or Codex without a logged-in CLI), interactive `sanook` brings back the setup wizard so the recovery hint is actually actionable.
- **Provider menu env-key labels now use the same key policy as runtime.** Malformed/OAuth env keys show as unusable instead of a misleading ready checkmark.
- **`/model gpt` no longer leaves the REPL in a raw alias state.** Slash-command model changes now store canonical `provider:model-id` specs (for example `openai:gpt-5.5`), and missing OpenAI-key messages point ChatGPT-plan users to `/model codex` + `codex login`.
- **The REPL banner no longer redraws after every command on terminals that keep Ink frames in scrollback.** The welcome banner renders only before history exists; the live model stays visible in the footer.
- **`config set embeddingModel ...` is now supported.** The README documented this semantic-search setting, but the config allowlist/schema did not accept it.
- **Help/docs cleanup.** The CLI help no longer points at the deprecated OpenAI Codex model id, and the README test badge was refreshed.

### Setup wizard — better provider selection + working OpenAI Codex login

- **Provider menu**: each option now shows a one-line hint — `✓ key ใน env ใช้ได้`, `key ใน env ใช้ไม่ได้`, `local · ไม่ต้อง key`, `login ChatGPT · ไม่ใช้ API key`, or `ต้องมี API key` — and the list is ordered (popular cloud → others → local → Codex). The API-key step shows the expected key format.
- **OpenAI Codex (ChatGPT plan)**: picking Codex used to skip straight past auth. It now runs a dedicated step that detects whether the `codex` CLI is installed and logged in (reads `~/.codex/auth.json` — robust inside sandboxes where `codex login status` can panic), and guides you: `npm i -g @openai/codex` → `codex login` → re-check, then continues automatically once you're signed in. No API key required.
- **Codex runs**: `codex exec` now runs through the current non-interactive JSON CLI surface, uses the requested sandbox (`read-only` by default, `workspace-write` in auto mode), and removes `OPENAI_API_KEY` from the child env so it can't fight the ChatGPT-plan login (codex #2733/#3286). Verified against the installed Codex CLI surface.

## 0.5.0

### Install UX — `sanook doctor` + post-install guidance (the "`sanook` is not recognized" fix)

The #1 first-run snag is `npm i sanook-cli` **without `-g`** → a local install that never lands on PATH, so typing `sanook` fails. Two root-cause fixes:

- **`sanook doctor`** — a new diagnose-and-fix command. Checks Node version, the npm global-bin dir, whether the `sanook` shim is installed there, whether that dir is on PATH, and whether a local install exists in the cwd — then prints the **exact, OS-safe remedy**. On Windows it emits the *safe* user-PATH PowerShell one-liner (`[Environment]::SetEnvironmentVariable(... 'User')`), deliberately **not** `setx %PATH%` (which truncates PATH at 1024 chars and duplicates the system PATH — a known corruption footgun). Runnable as `npx sanook doctor` even before a global install.
- **post-install hint** — right after `npm i`, the installer now prints the working command: local install → `npx sanook` or `npm i -g sanook-cli`; global install → "ready, type `sanook`". Never fails the install (always exits 0); stays quiet during repo-dev self-installs and CI.

### Cross-platform hardening — Windows / macOS / Linux

Audited the whole codebase (process spawning, paths, external deps, terminal) and fixed the real Windows breakers:

- **Child-process spawning on Windows**: `npx`/`npm`/`codex` are `.cmd` shims, so `spawn('npx', …)` failed with ENOENT — breaking **MCP servers** (incl. the second-brain filesystem MCP), **`sanook update`**, and the **Codex provider**. Now spawned with `shell` on `win32`. (`hooks` already used a shell; git/LSP already resolve correctly.)
- **`grep` works without ripgrep**: if `rg` isn't installed (common on a fresh Windows box) the grep tool now falls back to a pure-Node search (recursive walk, default-ignore set, binary/large-file skip, CRLF-aware) instead of a cryptic `spawn rg ENOENT`. Verified end-to-end with `rg` removed from PATH.
- **The agent knows its OS**: the system prompt now states the platform + shell, so on Windows it generates `dir`/`type`/`findstr` (or prefers the cross-platform read/list/glob/grep tools) instead of `ls`/`cat`/`grep` into cmd.exe.
- **CRLF-safe vault indexing**: the markdown chunker normalizes `\r\n` so frontmatter/sections parse identically on Windows.
- **Terminal**: respects `NO_COLOR` and auto-disables ANSI when output is piped/redirected (no `[2m` garbage on legacy cmd); `FORCE_COLOR` overrides.
- **Clear "not installed" errors** for `git` (and ripgrep) instead of raw `spawn … ENOENT`.
- (Prior turn) Node-version guard (≥ 22) with a clear message; install docs clarified for `-g` / `npx` / Windows `setx`.

### Skills — 16 more real-work skills, author+verify reviewed (130 → 146)

A second, larger batch filling concrete gaps in distributed-systems correctness, testing rigor, frontend, security, and AI — each one **independently verified** (a separate reviewer agent read the written file and judged frontmatter validity, structure, cross-reference resolution, technical accuracy, and *actionability* — would an agent actually be able to follow it; all 16 passed):

- **Backend/distributed**: `design-api-pagination` (cursor/keyset, stable ordering, Relay connections), `distributed-locks-leases` (Redlock caveats + fencing tokens, leader election), `design-state-machine` (explicit FSM/statecharts vs boolean-flag soup), `schema-evolution-compatibility` (backward/forward compat, reserve-don't-reuse, expand-then-contract).
- **Testing**: `debug-flaky-tests` (taxonomy + root-cause fixes, not retry-masking), `test-data-factories` (factories over fixtures, faker, deterministic seeds), `property-based-testing` (invariants + shrinking), `contract-testing` (consumer-driven Pact + can-i-deploy), `visual-regression-testing` (deterministic screenshots).
- **Frontend**: `build-data-table` (virtualized sortable/filterable grids), `optimize-react-rerenders` (profiler-driven memoization).
- **Security**: `configure-security-headers-csp` (strict CSP with nonces, HSTS, CORS done right), `encrypt-sensitive-data` (KMS envelope encryption, AEAD, key rotation).
- **AI/LLM**: `build-vector-search` (ANN indexes, hybrid + RRF, eval), `structured-output-llm` (json_schema/tool-calling + validate-and-repair).
- **DevEx**: `debug-ci-pipeline-failure` (reproduce locally, classify, fix root cause).

All load cleanly (catalog now 146), cross-reference only real sibling skills, and follow the When-to-Use + NOT-this-skill + dense Steps structure.

### Skills — 7 high-value additions, closing reliability/integration gaps (123 → 130)

New bundled skills filling conspicuous holes in the catalog, authored to the existing dense, cross-referenced bar:

- **resilience-timeouts-retries** — timeouts on everything, deadline propagation, retry-only-if-idempotent, exponential backoff + full jitter, circuit breakers, bulkheads, load-shedding (the general reliability primitive the catalog was missing alongside `rate-limiting`).
- **idempotency-keys** — make writes safe to repeat: idempotency by design (PUT/upsert/conditional) vs by key (the `Idempotency-Key` header pattern, dedup table, 409/422, outbox), consumer-side dedup, "effectively-once".
- **integrate-oauth-oidc** — "Log in with Google/GitHub/…": Authorization Code + PKCE, state/nonce, server-side token exchange, full ID-token validation, safe `email_verified` account linking, refresh rotation, native system-browser-only. Complements `auth-jwt-session` (which owns *your* session).
- **send-transactional-email** — the deliverability half: SPF/DKIM/DMARC alignment, provider-not-cold-MTA, transactional/marketing stream isolation, bounce/complaint → suppression, idempotent sends, sandbox testing.
- **design-multi-tenancy** — tenant isolation models (shared+RLS / schema / DB-per-tenant), the #1 cross-tenant-leak bug + defense-in-depth (app scoping + Postgres RLS), tenant context propagation, per-tenant migrations/export/delete.
- **build-cli-tool** — argument parsing, exit codes, stdout=data/stderr=logs, TTY/NO_COLOR, config precedence (flags>env>file), no-secrets-in-flags, dry-run — the CLI/UX design counterpart to `shell-script-robust`.
- **deliver-webhooks** — the *producer* side: HMAC signing + rotation, replay tolerance, at-least-once retries + dead-letter + replay, stable event ids for consumer dedup, SSRF defenses — complements `ingest-webhook-secure` (the receiver).

Each loads cleanly (frontmatter `name`/`description`/`when_to_use`), cross-references only real sibling skills, and follows the When-to-Use + NOT-this-skill + Steps structure.

### Onboarding & ease-of-use — no more dead-ends, clearer guidance

The first-run / no-key experience now guides instead of dumping a raw error, and the REPL surfaces more of what's available:

- **Headless with no key no longer dead-ends**: `sanook "task"` before any key is set now prints an actionable hint — run `sanook` for the wizard, or `export <ENV>=…` with the **provider console URL** to get a key — and, if a *different* provider's key is already in the environment, it suggests `sanook -m <that-provider> "…"`.
- **Smart first-run**: if an API key is already in the environment (e.g. you `export ANTHROPIC_API_KEY=…` before installing), sanook skips the setup wizard, picks that provider, and confirms `✅ ready` instead of asking you to re-enter everything.
- **Setup wizard** now shows the **console URL** for the chosen provider at the key step, and the run ends with a clear `✅ ตั้งค่าเสร็จ — พิมพ์งานได้เลย`.
- **Actionable key errors**: a missing key names the provider + console URL + how to set it; a wrong-format key shows a readable example (`sk-ant-…`, `AIza…`) instead of a raw regex (and the example is kept short so redaction doesn't mangle it).
- **Discoverability**: `/tools` now lists the orchestration tools (`task_parallel`/`task_spawn`/`task_collect`/`task_cancel`/`task_status`) and `diagnostics`; `/help` points to the shell-side commands (`search`/`index`/`brain`/`serve`/`mcp serve`/`config set`); the REPL empty-state hints `/help` and `/tools`.

### Token/cost tuning knobs — 1h cache, summarize-compaction, sub-agent routing, thinking budget

New `config.json` fields (and `SANOOK_*` env overrides) that trade tokens/cost without hurting quality — read once per turn via `agentTuning()`:

- **`cacheTtl: "5m" | "1h"`** (env `SANOOK_CACHE_TTL`): the Anthropic prompt-cache lifetime. `"1h"` keeps the cached preamble alive across pauses (lunch, a meeting) so resuming doesn't re-pay full price for it. Default `"5m"` (unchanged).
- **`compaction: "truncate" | "summarize"`** (env `SANOOK_COMPACTION`): when the conversation gets long, `"summarize"` condenses the dropped middle with a **cheap model** (the fast sibling of your main model, same key — `fastSibling()`) instead of truncating it — better recall at the same token budget. Used by `/compact` and proactively before very long turns; falls back to truncation if the summarizer fails (never blocks a turn). Default `"truncate"` (zero-LLM, unchanged). `src/compaction.ts` `summarizeCompact()` is pure (injected summarizer) and unit-tested with no network.
- **`SANOOK_SUBAGENT_MODEL`**: route all sub-agent work to a cheaper model (e.g. `haiku`) while the main agent keeps the strong one — big savings for exploration-heavy runs. Default: inherit the parent model.
- **`thinking: true | <budget>`** (env `SANOOK_THINKING`): opt-in Anthropic extended thinking on the **main** agent only (never sub-agents), with a hard `budgetTokens` cap so reasoning can't run away. Default off (no change).

### Token efficiency — line-range reads + targeted edits

Two quality-neutral cuts to per-turn token cost (the model asks for exactly what it needs):

- **`read_file` line ranges**: `read_file({ path, offset?, limit? })` returns just lines `offset..offset+limit` (with a `[lines A–B of N]` header) instead of the whole file. Paired with `grep` (which already returns line numbers), the model reads a small window around a symbol rather than an entire large file — large input-token savings, identical result. Default (no offset/limit) is unchanged. The system prompt now nudges grep→read-range over whole-file reads.
- **`edit_file` `replace_all`**: rename/repeated edits use a short `old_string` with `replace_all: true` instead of padding it with surrounding context for uniqueness (which the model otherwise sends twice, old + new). The ambiguous-match error now suggests `replace_all` rather than "add more context".
- **Terser replies**: the system prompt tells the agent not to paste back file contents / large code blocks it just read or edited (the user already sees the diff) — cuts output tokens with no loss.
- **Sub-agent model routing** (`SANOOK_SUBAGENT_MODEL`): opt-in env that routes all sub-agent work to a cheaper model (e.g. `haiku`) while the main agent keeps the strong model — big cost savings for exploration-heavy runs, default unchanged (inherit the parent model).

### LSP diagnostics — `diagnostics` tool (type errors without a full build)

A Node-native, zero-dependency Language Server Protocol client (`src/lsp/`) gives the agent a tight edit→check feedback loop: after editing a file it can pull the language server's diagnostics (type errors / lint) for that one file, no project-wide compile.

- **`diagnostics` tool**: `diagnostics({ path, content? })` → ranked errors/warnings as `✗ path:line:col message [code]`. Pass `content` to check an unsaved buffer. Respects worktree scoping (`agentCwd`) and the read-path guard.
- **Real LSP client** over Content-Length framing (distinct from MCP's newline framing): initialize handshake, `didOpen`/`didChange`, diagnostics that **settle** (a quiet period after the last publish so we return the final set, not an early empty one), and it answers server→client requests so a server can't stall. Positions convert from LSP 0-based to human 1-based.
- **Server pool**: servers are spawned once per (binary, workspace) and reused — re-checking a file becomes a `didChange`, so the slow project-load cost is paid once, not per call.
- **Zero-config floor**: sanook bundles no language servers (like ripgrep). It maps extension → conventional server (typescript-language-server, pyright, gopls, rust-analyzer, vscode-json-language-server, bash-language-server), detects whether it's installed (node_modules/.bin or PATH), and when it isn't, returns a clear install hint instead of crashing.
- Tests: the framing codec (split frames, multibyte, malformed-recovery), the client handshake + diagnostics-settle + server-request handling against a **fake server** (no real LSP needed), the server registry + binary detection, and the tool's graceful degradation. Verified end-to-end against a real `typescript-language-server` (caught TS2322 at the right position; pooled `didChange` cleared it after a fix).

### Real-time steering — interrupt a running turn + queue follow-ups (REPL)

The interactive REPL was input-locked while the agent worked, and Ctrl+C quit the whole app. Now a turn is steerable:

- **Interrupt mid-turn**: the running turn gets a real `AbortController` (wired into `runAgent`'s `signal`). Press **Esc** (or Ctrl+C) to stop the stream/tool loop right away and return to the prompt — without exiting the app. Partial output is kept for reference, the turn is dropped from the model history, and any files a tool already changed are recoverable via `/rewind`.
- **Type-ahead queue**: you can type while the agent is busy; pressing Enter **queues** the message and it runs automatically as the next turn when the current one finishes. The queue view now keeps an active row, ↑/↓ moves it while the draft is empty, and **Ctrl+X** deletes the selected queued prompt. Interrupting clears the queue.
- Covered by Ink integration tests (mocked agent) asserting the signal is passed, input queues while busy, Ctrl+X deletes active queued prompts, and Esc both aborts and clears the queue.

### Worktree isolation — safe parallel WRITE subagents (`task_parallel isolate:true`)

Parallel subagents that edit files would clobber a shared tree. Now each write subagent can run in its own throwaway **git worktree** (`src/worktree.ts`), branched from the current HEAD, and its changes are merged back afterward:

- **Per-agent working directory**: `AgentContext` gains a `cwd`, and every file tool (read/write/edit/list/glob/grep/bash) plus the write-confinement guard (`permission.allowedRoots`) now resolve through `agentCwd()`. A subagent's relative path (`src/foo.ts`) lands in ITS worktree, not the main tree — so isolation can't leak. The main agent is unchanged (no `cwd` ⇒ `process.cwd()`); the OS sandbox already confines writes to the active cwd, so a worktree is automatically sandboxed.
- **`task_parallel isolate:true`**: creates a worktree per write subagent, runs them concurrently in isolation, captures each worktree's diff, and applies them back to the main tree **sequentially** with `git apply --3way` — conflicts are reported (with the touched files), never silently overwritten. Worktrees are always cleaned up. Requires a git repo (falls back with a clear message otherwise).
- **`src/worktree.ts`**: `createWorktree` / `captureDiff` (incl. untracked) / `applyDiff` / `removeWorktree` / `runInWorktrees`, all over the existing `runGit` helper. The create→isolate→merge→cleanup lifecycle is unit-tested against a real throwaway git repo with an injected work callback (no agent/network), covering the round-trip, the parallel different-files case, empty diffs, non-git fallback, and conflict reporting.

### Subagent orchestration — parallel fan-out + background + nested (`task_parallel` / `task_spawn` / `task_collect` / `task_cancel` / `task_status`)

The single one-shot `task` subagent grows into a real orchestration layer (`src/orchestrate.ts`):

- **Parallel fan-out** (`task_parallel`): run up to 16 subagents concurrently with a real concurrency cap and **per-item error isolation** (one failure never sinks the batch); results returned in order. For independent work — explore N modules, review N angles — instead of serial subagents.
- **Background / async** (`task_spawn` → `task_collect` / `task_cancel` / `task_status`): spawn a detached subagent, get an id immediately, keep working, gather the result later in the same session, or cancel it. `task_collect` supports a timeout so the agent can poll instead of block; failures are captured as `error` state (never an unhandled rejection); `task_cancel` aborts via the subagent's `AbortSignal`.
- **Nested**: subagents may themselves `task` / `task_parallel` (bounded by the depth cap), so the main agent can decompose, then each branch can decompose again.
- **Parallel-safe context**: each subagent runs inside its own `AsyncLocalStorage.run()` scope, so concurrent/nested agents never bleed model/budget/depth into one another.
- Orchestration core is pure with an **injected runner** + injectable clock/id-gen, unit-tested with a fake runner (concurrency cap, error isolation, spawn/collect/cancel/timeout) — zero model calls in CI.

### Brain search — hybrid semantic search over the second brain (`sanook index` / `sanook search` / `sanook mcp serve`)

A Node-native search subsystem (`src/search/`) over the second-brain vault **plus** bi-temporal memory, past sessions, and skills — one ranked surface, zero new heavy deps.

- **Real BM25, zero-dependency floor**: a pure-TS inverted index (k1=1.2, b=0.75, genuine corpus-stat IDF, title field-boost) — no SQLite, no Bun, no native binary, works with no key and no network on any OS Node 22 runs on. Tokenization builds on the canonical `normalize()` and segments with `Intl.Segmenter` so **Thai** splits into real words.
- **Incremental indexer** (`sanook index`): mtime+size+sha256 manifest diff over the existing vault via `brainPath` — O(delta), unchanged files cost one `stat()`, deleted files are evicted precisely. No `ψ/`-style directory convention required. Folds in active memory facts (with an importance prior; quarantined/inbox facts excluded), recent sessions, and skills.
- **Optional BYOK semantic** (`--mode hybrid|semantic`): embeddings through your *existing* provider key (`@ai-sdk/{openai,mistral,google,…}` `embedMany`), stored as a compact Float32 sidecar, cosine in-process over a candidate set; fused with BM25 via **Reciprocal Rank Fusion** (scale-free, k=60). Lazy — absent without a key; a model change self-invalidates the cache. Degrades silently to BM25 on any embedding error.
- **MCP SERVER** (`sanook mcp serve`): sanook was MCP client-only; it now also *exposes* a stdio JSON-RPC server (`sanook_search` / `sanook_recall` / `sanook_remember` / `sanook_index` / `sanook_stats`), so Claude Desktop / Cursor / any MCP host can mount sanook's brain. Same zero-dep framing as the client; stdout stays protocol-clean.
- **`recall` upgraded**: the agent's recall tool now ranks by BM25 across all four corpora with snippets (was substring term-counting), and folds freshly-`remember`ed facts in on every call.
- Tests: BM25 ranking/IDF/no-posting-creep, heading chunker + frontmatter + wikilinks, RRF, incremental indexer (in-memory fs), cosine/serialize (fake vectors), engine modes + degradation, MCP server dispatch + a real piped-child round-trip (≈70 new).

### Competitive parity pass (table-stakes the OSS field now expects)

- **Remote MCP**: connect MCP servers over Streamable-HTTP (`{ "url": "https://…", "headers": {…} }`), not just stdio — half the hosted MCP ecosystem (GitHub/Slack/Postgres/…) is HTTP-only. `sanook mcp add <name> <url>` auto-detects remote.
- **Prompt caching**: the static system preamble (instructions + skills + brain + repo map) is sent as a cached Anthropic block, cutting cost/latency on multi-step turns; safely ignored by other providers.
- **OS sandbox for `run_bash`**: Seatbelt (macOS) / bubblewrap (Linux) confine shell **writes** to the workspace/brain/tmp — defense-in-depth over the regex blocklist. Reads + network unchanged; `SANOOK_NO_SANDBOX=1` to disable.
- **Checkpoint + `/rewind`**: a shadow-git snapshot before each turn; `/rewind` restores files **and** truncates the conversation (recoverable — it stashes the current state first).
- **Input ergonomics**: multiline (trailing `\` / Alt+Enter), `↑`/`↓` persisted prompt history, readline keys (Ctrl-A/E/U/K/W), and `@file` mentions that inline file contents.
- **Image / vision input**: `@image.png` attaches the image to vision-capable models (history keeps a lightweight placeholder, not the bytes).
- **Custom slash commands**: `.sanook/commands/<name>.md` prompt templates invoked as `/<name>` (project commands gated by trust).
- **Repo map**: a zero-dep, git-aware symbol map injected at session start so the agent selects files without blind grepping.
- **Reliability**: rate-limit/overload retry with exponential backoff, kept distinct from auth/billing failures (which fail fast); per-tool execution timeouts so a runaway read/grep can't hang the loop.
- **Minimal terminal-first TUI**: compact gradient banner, a real cursor + placeholder, and cleaner turn rendering.

### Fixes

- **Multi-turn history loss**: REPL/`--continue` now retain the full conversation (the user's earlier turns were being dropped — only assistant/tool messages were kept).
- **Budget cap was silent for ~all non-Anthropic models**: added approximate list prices for the other providers, a `pricing` override (`sanook config set pricing …` / `SANOOK_PRICING`), and a warning when `-b` is set for a model (or fallback model) with no pricing. Cost now carries over when the model falls back instead of resetting.
- MCP SSE parsing no longer aborts on a malformed earlier event; checkpoint restore pins the snapshot commit (correct even after an intervening commit) and removes files added after the snapshot.

- Tests: remote-MCP, sandbox, repo map, prompt-caching/system-preservation, rate-limit classification, tool timeout, checkpoint restore, cost merge, custom commands (≈200 total).

## 0.4.0 — second brain, Telegram, hardening

- **Second brain**: `sanook brain init` scaffolds a portable Obsidian "second-brain" workspace — full folder taxonomy (each with `_Index.md`), a central `Vault Structure Map.md`, seed memory files, and a portable AI operating constitution (`CLAUDE/GEMINI/AGENTS.md`). Research-backed rules: context-assembly (anti context-rot), intake quarantine + injection-scan, bi-temporal fact validity, provenance tracking, a verification-gated `Skills/` library, sleep-time consolidation. The agent now **loads the vault** into context, and `brain init` **auto-wires a filesystem MCP** to it. First-run wizard offers to create one (personalized).
- **Telegram channel**: drive the agent from your phone (long-polling, fail-closed allowlist, private-only). Remote surface defaults to ask-mode (mutations denied) unless `TELEGRAM_ALLOW_WRITE=1`.
- **Auto-compaction**: token-aware sliding window keeps long sessions under the limit.
- **Interactive approval** (`ask` mode) + capability-based gating — any non-read-only tool (incl. MCP) is confirmed before running.
- **REPL resume** (`sanook -c`), **stdin piping** (`git diff | sanook "review"`), gateway multi-turn history, and `sanook config` / `sanook mcp` management commands.
- **Provider audit**: corrected stale model ids (OpenAI `gpt-5.3-codex`, xAI `grok-4.3`).
- **Hardening**: budget cap now actually fires on the default fast model; write paths confined (no `~/.sanook` / shell-rc / ssh backdoors); MCP child processes get a minimal env (no secret leakage); provider errors surface a clean one-line message; versions read from `package.json`. Added tests for the BYOK/redaction core and budget cap.

## 0.3.0 — providers, memory, gateway, MCP, git

- **Providers**: data-driven registry, now 9 providers (including OpenAI Codex via the official CLI). Per-provider model picker that fetches the live model list.
- **Memory**: auto-memory (`remember` / `recall`), session resume (`--continue`), and in-session REPL conversation history.
- **Gateway + cron**: `sanook serve` runs a loopback HTTP endpoint (OpenAI-compatible) plus a cron scheduler with natural-language scheduling, backed by a file-locked JSON task ledger.
- **Skills**: load `SKILL.md` files on demand; the agent can author its own with `create_skill`.
- **Subagents**: a `task` tool spawns a fresh-context sub-agent (read-only by default, depth-guarded).
- **Hooks**: PreToolUse / PostToolUse commands via `~/.sanook/hooks.json`.
- **Plan mode** (`--plan`): read-only exploration that produces a plan before acting.
- **MCP**: connect Model Context Protocol servers (stdio) via `~/.sanook/mcp.json`.
- **Git**: automatic git context in the prompt + `git_status` / `git_diff` / `git_log` / `git_commit` tools.
- Onboarding: welcome banner + first-run setup wizard.
- Hardened across several adversarial reviews — command injection, prompt injection, concurrency, and secret redaction.

## 0.1.0 — first usable release

A terminal AI coding agent, built from scratch in TypeScript. BYOK, works with any model.

- **Agent loop** on Vercel AI SDK 6 (`streamText` + `stopWhen` + `fullStream`), streamed output
- **Tools**: read / write / edit (multi-tier matcher) / list / glob / grep / bash, with a permission gate (denies destructive commands + protected paths)
- **Multi-provider BYOK**: Anthropic / OpenAI / Google / Ollama via one model spec; direct API key only (no OAuth/subscription reuse)
- **Cost meter** + budget cap (per-token, cache-aware)
- **Context memory**: hierarchical `SANOOK.md` loader (stops at project boundary) + tool-result compaction
- **Ink TUI** REPL with slash commands (`/model` `/cost` `/clear` `/compact` `/help`), plus headless `--json` mode for CI
- Eval harness (outcome-checked tasks) + CI matrix (mac/linux/windows × Node 22/24)
