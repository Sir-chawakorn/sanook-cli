---
tags: [template, final-gate, verification, lite]
note_type: template
created: YYYY-MM-DD
updated: YYYY-MM-DD
parent: "[[Templates/_Index]]"
---

# YYYY-MM-DD - <task/topic> - Final Gate Lite

> Final gate แบบสั้นสำหรับงานเล็กถึงกลาง: ยังต้องล็อก objective, evidence, risk, final answer, และ memory routing; ถ้า row ไม่มี evidence ห้าม mark `PASS`

## 0. Final Gate Rule

- [ ] Created before the owner-facing final answer.
- [ ] Every `PASS` has evidence.
- [ ] If a row has no evidence, it cannot be `PASS`.

Status: `PASS`, `PARTIAL`, `FAIL`, `N/A`, `BLOCKED`, `TODO`.

## 1. Objective / DoD Lock

Original request:

```text
<paste owner request or goal text here>
```

| DoD item | Status | Evidence |
|---|---|---|
| Objective is concrete. | TODO |  |
| Deliverable exists in the right place. | TODO |  |
| Owner-facing answer can be backed by evidence. | TODO |  |

## 2. Evidence-Backed Checklist

| Gate | Status | Evidence |
|---|---|---|
| Relevant context was read. | TODO |  |
| No unrelated worktree changes were reverted. | TODO |  |
| Verification ran at the right scope. | TODO |  |

## 3. Status Matrix

| Work item / phase | Status | Evidence |
|---|---|---|
| Implement/write/edit | TODO |  |
| Verify | TODO |  |
| Close memory/session if needed | TODO |  |

## 4. Evidence Matrix

Commands:

| Command | Status | Important output | Scope proven |
|---|---|---|---|
| `<command>` | TODO |  |  |

Changed files:

| File | Change summary | Evidence |
|---|---|---|
| `<file>` |  |  |

## 5. Residual Risk

| Risk or skipped check | Status | Evidence / reason |
|---|---|---|
| `<risk>` | TODO |  |

## 6. Change Summary Audit

What changed:

- <short summary>

What did not change:

- <important non-change or unrelated worktree file>

## 7. Final Answer Draft

```text
<short final answer>

Verified:
- <command/result>

Residual risk:
- <risk or "none known">
```

## 8. Second-Brain Routing / Memory Closeout

| Routing item | Status | Evidence |
|---|---|---|
| Session/index/current-state update needed? | TODO |  |
| Durable memory/decision update needed? | TODO |  |
| Search/index refresh needed? | TODO |  |

## Final Verdict

| Verdict | Status | Evidence |
|---|---|---|
| Ready to close / caveat / blocked | TODO |  |

One-line final state:

> <state + evidence>

up:: [[Templates/_Index]]
