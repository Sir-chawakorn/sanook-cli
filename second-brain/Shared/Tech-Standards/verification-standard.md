---
tags: [standard, verification, dod]
note_type: standard-reference
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Tech-Standards/_Index]]"
ai_surface: hot
---

# Verification Standard

> Definition of done for technical changes made with this vault.

## Default Verification Ladder

1. Read the relevant source before editing.
2. Run the narrowest meaningful check first.
3. Run the broader suite when touching shared behavior.
4. Build/package smoke when the change affects release output.
5. Record residual risk if a check cannot be run.

## Evidence Format

Use this shape in session logs and handoffs:

```text
Verification:
- npm run typecheck: PASS
- npm test: PASS
- npm run build: PASS
- Smoke: <command/result>
```

## Never Claim Done If

- Tests were skipped without saying why.
- The changed behavior was not exercised.
- A generated artifact was not opened/rendered when visual layout matters.

up:: [[Shared/Tech-Standards/_Index]]
