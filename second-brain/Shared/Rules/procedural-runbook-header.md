---
tags: [rule, runbook, procedure]
note_type: rule
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Rules/_Index]]"
---

# Procedural Runbook Header

> Minimum header for any reusable procedure in `Runbooks/`.

```yaml
---
tags: [runbook]
note_type: runbook
created: YYYY-MM-DD
updated: YYYY-MM-DD
parent: "[[Runbooks/_Index]]"
status: active
success_rate: unknown
runs: 0
---
```

## Required Sections

1. Purpose
2. Preconditions
3. Steps
4. Verification
5. Rollback / Recovery
6. Known Failure Modes
7. Change Log

## Promotion Rule

If a runbook becomes executable and has a reliable verification command, promote the executable unit to `Skills/` and leave the explanatory prose here.

up:: [[Shared/Rules/_Index]]
