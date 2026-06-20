---
tags: [project, repo, {{SLUG}}]
note_type: project-repo
created: {{DATE}}
updated: {{DATE}}
parent: "[[Projects/{{SLUG}}/_Index]]"
---

> Machine-readable repo mapping — Sanook uses `repo_path` to auto-detect this project from cwd.

# Repo — {{TITLE}}

> Machine-readable repo mapping for Sanook project auto-detect.

repo_path: {{REPO_PATH}}
default_branch: {{DEFAULT_BRANCH}}
verify: {{VERIFY}}

## Paths

| What | Path |
|---|---|
| Repository | `{{REPO_PATH}}` |
| Vault workspace | `Projects/{{SLUG}}/` |

## Commands

```bash
cd {{REPO_PATH}}
{{VERIFY}}
```

up:: [[Projects/{{SLUG}}/_Index]]
