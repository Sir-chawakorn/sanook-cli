---
tags: [research, second-brain, hermes, ai-agent, context-engineering]
note_type: research-note
created: 2026-06-18
updated: 2026-06-18
parent: "[[Research/_Index]]"
source::
  - https://github.com/NousResearch/hermes-agent
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/curator
  - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
  - https://docs.langchain.com/oss/python/concepts/memory
  - https://arxiv.org/abs/2304.03442
  - https://arxiv.org/abs/2310.08560
  - https://arxiv.org/abs/2303.11366
  - https://arxiv.org/abs/2210.03629
  - https://fortelabs.com/blog/para/
related:: [[Runbooks/ai-second-brain-operating-sequence]]
related:: [[Shared/AI-Context-Index]]
related:: [[Evals/second-brain-benchmarks]]
---

# Hermes CLI Second-Brain Expansion Research

> Research note for deciding what to add to this second-brain so Hermes CLI can use it better. Created after comparing the current vault structure with Hermes Agent docs, agent memory research, context-engineering guidance, eval patterns, and PARA-style knowledge management. This note becomes stale when Hermes context/memory/skills semantics change materially.

## Bottom Line

Scope correction on 2026-06-18: this note is reference material for Hermes compatibility only. If the objective is Sanook CLI itself, use [[Projects/sanook-cli/second-brain-feature-roadmap]] instead.

อย่าเพิ่ม root-level folder เยอะตอนนี้. โครงสร้างปัจจุบันมี knowledge pipeline, memory, context packs, evals, coordination, and runbooks ครบกว่าค่าเฉลี่ยแล้ว.

สิ่งที่ควรเพิ่มถัดไปคือชั้นที่ทำให้ Hermes ใช้ของที่มีอยู่ได้แม่นขึ้น:

1. `HERMES.md` หรือ `.hermes.md` adapter สำหรับ Hermes CLI โดยเฉพาะ.
2. `Shared/Hermes/` หรืออย่างน้อย `Shared/Agent-Adapters/hermes.md` สำหรับ config, memory sync, toolset, and curator policy.
3. `Evals/Benchmarks/` สำหรับ benchmark cases แยกเป็นไฟล์เล็กๆ แทนการโตในไฟล์เดียว.
4. `Acceptance/Golden-Cases/` สำหรับ input -> expected output ของ Hermes workflows.
5. `Reviews/Vault-Health/` สำหรับ scheduled curator-style review ของ vault/context/skills.

## Evidence From Hermes

Hermes context files:

- Hermes supports `.hermes.md` / `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, `SOUL.md`, `.cursorrules`, and Cursor rule modules.
- Priority is first-match: `.hermes.md` -> `AGENTS.md` -> `CLAUDE.md` -> `.cursorrules`; `SOUL.md` is separate global identity.
- Hermes loads one project context type per session, then progressively discovers subdirectory context files as tools touch paths.
- Context files are security scanned, truncated, and should stay concise with headers, examples, negative constraints, key paths, and stale-context hygiene.

Implication for this vault:

- Current `AGENTS.md` works as fallback, but Hermes-only usage should prefer a dedicated `HERMES.md` / `.hermes.md` so Hermes does not inherit adapter compromises meant for other agents.
- Because Hermes progressively discovers subdirectory files, scoped context files can be more useful than one giant root instruction file.

Hermes memory:

- Built-in memory is deliberately tiny: `MEMORY.md` for agent notes and `USER.md` for user profile, both loaded once as a frozen snapshot at session start.
- Hermes explicitly separates always-on memory from on-demand session search.
- Memory writes can be gated with approval, and memory entries should be compact, specific, and non-duplicative.

Implication for this vault:

- Keep Hermes memory small and use the vault as the long-term source of truth.
- Add a Hermes memory sync policy: what goes to `~/.hermes/memories/MEMORY.md`, what stays in `Shared/User-Memory`, what is retrieved on demand from vault search/session logs.

Hermes skills:

- Skills are on-demand knowledge documents with progressive disclosure.
- `SKILL.md` supports references, templates, scripts, assets, platform restrictions, required environment variables, and verification sections.
- Hermes can scan external skill directories, but writable external dirs are not a write-protection boundary.

Implication for this vault:

- Current `.agents/skills/` can become a shared skill source, but it needs an explicit policy for which skills are read-only, owner-authored, or agent-created.
- Useful repeatable vault workflows should graduate into Hermes skills only after they have examples, pitfalls, and verification.

Hermes curator:

- The curator tracks skill usage, marks stale skills, archives long-unused skills, and can optionally run an LLM consolidation pass.
- It has status, dry-run, backup, rollback, pin, and archive commands.

Implication for this vault:

- Add curator-like vault health reviews: stale context, duplicated rules, unused context packs, benchmark drift, and skills that should be archived or pinned.

## Evidence From Agent Research

Context engineering:

- Anthropic frames context as finite and context engineering as the task of curating all tokens available to an agent across long-running loops, not just writing better prompts.
- This supports the current Scientific Loop Sequence and argues for smaller, task-specific retrieval bundles rather than a larger global instruction file.

Memory taxonomy:

- LangGraph separates short-term thread-scoped memory from long-term memory across conversations, and uses semantic, episodic, and procedural memory categories.
- Generative Agents stores experiences, synthesizes reflections, and retrieves memories dynamically for planning.
- MemGPT argues for tiered memory and movement between fast context and slower external memory.
- Reflexion stores reflective text in episodic memory after feedback to improve future trials.
- ReAct shows the value of interleaving reasoning/action with external information retrieval.

Implication for this vault:

- Current folders already map well:
  - semantic memory -> `Learning/`, `Distillations/`, `Entities/`, `Shared/Core-Facts/`
  - episodic memory -> `Sessions/`, `Retrospectives/`, `Traces/`
  - procedural memory -> `Runbooks/`, `Playbooks/`, `Skills/`, `.agents/skills/`
  - eval/reflection memory -> `Evals/`, `Acceptance/`, `Reviews/`
- The missing piece is not another generic "Resources" folder. It is sharper eval cases, Hermes adapter policy, and scheduled consolidation.

PKM / PARA:

- PARA's Projects / Areas / Resources / Archives split supports action-oriented retrieval.
- This vault already extends PARA with AI-specific layers: Evals, Acceptance, Rules, Context-Packs, Provenance, Coordination.

Implication for this vault:

- Avoid adding broad folders like `Resources/`, `Notes/`, or `AI/`; they would overlap existing canonical homes.

## Gap Analysis

| Gap | Current coverage | Recommended addition | Priority |
|---|---|---|---|
| Hermes-specific project context | `AGENTS.md` only | `HERMES.md` or `.hermes.md` pointing to hot path and Hermes-only rules | P0 |
| Hermes memory policy | `Shared/User-Memory`, `Shared/Memory-Inbox`, `USER.md` | `Shared/Hermes/memory-sync-policy.md` or `Shared/Agent-Adapters/hermes-memory.md` | P0 |
| Hermes skill lifecycle | `.agents/skills`, `Skills/`, `Shared/Rules/skills-admission` | `Shared/Hermes/skill-lifecycle.md` plus first Hermes skill for second-brain maintenance | P1 |
| Atomic benchmarks | `Evals/second-brain-benchmarks.md` | `Evals/Benchmarks/<case-id>.md` | P1 |
| Golden fixtures | `Acceptance/golden-case-template.md` | `Acceptance/Golden-Cases/<workflow>.md` | P1 |
| Scheduled vault health | `Reviews/`, `Runbooks/sleep-time-consolidation.md` | `Reviews/Vault-Health/YYYY-MM-DD.md` | P1 |
| Prompt-injection trust boundary | `Intake/_Quarantine`, `ingest-quarantine`, Hermes scanner | `Shared/Security/trust-boundaries.md` only if rules grow beyond current files | P2 |
| Tool inventory and MCP capabilities | `Tools/`, `Shared/mcp-servers`, `Tech-Standards` | `Shared/Hermes/toolsets.md` if Hermes profiles/toolsets become important | P2 |
| Output artifacts per project | `Projects/<proj>/` role allows deliverables | Add `Projects/<proj>/Artifacts/` only inside active projects with many generated files | P2 |

## Recommended Next Build

Best next bundle:

1. Add `second-brain/HERMES.md`.
2. Add `second-brain/Shared/Hermes/_Index.md`.
3. Add `second-brain/Shared/Hermes/memory-sync-policy.md`.
4. Add `second-brain/Shared/Hermes/skill-lifecycle.md`.
5. Add `second-brain/Shared/Context-Packs/hermes-cli-vault-maintenance.md`.
6. Split 3-5 high-value cases from `Evals/second-brain-benchmarks.md` into `Evals/Benchmarks/`.

Implementation caution:

- If adding new folders, update [[Vault Structure Map]] and any folder scaffold source such as `src/brain.ts`.
- If adding only files under existing folders, keep the current taxonomy stable.
- Do not mirror Hermes `~/.hermes/` wholesale into the vault; keep local runtime state in Hermes home and store only policy, reviewed snapshots, and durable decisions here.

## Do Not Add Yet

- `Resources/` root folder: overlaps `Research/`, `Learning/`, and `Distillations/`.
- `Notes/` root folder: becomes a junk drawer and weakens routing.
- `AI/` root folder: duplicates `Shared/AI-Context-Index`, agent adapters, rules, and context packs.
- `Archive/` root folder: `Shared/Archive/` already exists.
- `Experiments/` root folder: use `Research/`, `Evals/`, or `Sessions/` depending on artifact type.

up:: [[Research/_Index]]
