---
tags: [coordination, agents, registry]
note_type: registry
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Coordination/_Index]]"
ai_surface: hot
---

# Agent Registry

> Who is allowed to touch the vault and what each agent should read first.

| Agent | Reads First | Writes | Notes |
|---|---|---|---|
| Claude | `CLAUDE.md` + `Shared/AI-Context-Index.md` | normal vault writes | Follow local tool safety. |
| Gemini | `GEMINI.md` + `Shared/AI-Context-Index.md` | normal vault writes | Follow COI activation rules. |
| Codex | `AGENTS.md` + `Shared/AI-Context-Index.md` | repo and vault writes | Prefer verified changes and concise handoffs. |

## Coordination Rule

Before making broad vault changes, read [[Shared/Coordination/NOW]] and update [[Shared/Coordination/task-board]] if the task spans multiple sessions.

up:: [[Shared/Coordination/_Index]]
