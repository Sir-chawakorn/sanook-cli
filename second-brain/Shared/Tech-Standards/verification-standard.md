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

## Final Gate

For non-trivial work, multi-file changes, framework changes, releases, or anything the owner may later audit, instantiate [[Templates/final]] before the final owner-facing answer.

The final gate must prove all eight closeout requirements:

1. Objective / DoD is restated and matched.
2. Checklist items have evidence, not only checked boxes.
3. Status uses `PASS`, `PARTIAL`, `FAIL`, `N/A`, or `BLOCKED`.
4. Evidence matrix lists commands, files, artifacts, and sources.
5. Residual risk and skipped checks are explicit.
6. Change summary distinguishes changed vs untouched work.
7. Final answer draft does not overclaim beyond evidence.
8. Second-brain routing / memory closeout is handled.

If a row has no evidence, it cannot be `PASS`.

## Never Claim Done If

- Tests were skipped without saying why.
- The changed behavior was not exercised.
- A generated artifact was not opened/rendered when visual layout matters.

up:: [[Shared/Tech-Standards/_Index]]
