---
tags: [template, final-gate, verification, dod]
note_type: template
created: YYYY-MM-DD
updated: YYYY-MM-DD
parent: "[[Templates/_Index]]"
---

# YYYY-MM-DD - <task/topic> - Final Gate

> ใช้เป็น phase สุดท้ายก่อนบอกว่า "เสร็จแล้ว" โดยตรวจ objective, DoD, evidence, risk, memory routing และ final answer draft; ไม่ใช้เป็น checklist ลอย ๆ ที่ไม่มีหลักฐาน

## 0. Final Gate Rule

- [ ] This final gate was created before the final owner-facing answer.
- [ ] Every PASS/PARTIAL/FAIL/BLOCKED claim below has evidence or an explicit reason.
- [ ] No unchecked item is silently treated as done.
- [ ] If evidence is missing, status is `PARTIAL`, `FAIL`, or `BLOCKED`, not `PASS`.
- [ ] If a row has no evidence, it cannot be `PASS`.

Status vocabulary:

| Status | Meaning | When to use |
|---|---|---|
| `PASS` | Requirement was satisfied and evidence proves it. | Command output, file path, rendered artifact, source citation, or reviewed diff exists. |
| `PARTIAL` | Some work was done, but evidence is incomplete or scope is narrower than requested. | Targeted test passed but full affected surface was not checked. |
| `FAIL` | Requirement was attempted and did not satisfy the gate. | Test failed, artifact missing, output contradicts requirement. |
| `N/A` | Gate does not apply to this task. | Visual QA for a non-visual note-only change. |
| `BLOCKED` | Work cannot proceed without owner input or external state. | Missing credential, unavailable service, unclear requirement after reasonable inspection. |

## 1. Objective / DoD Lock

Original request:

```text
<paste owner request or goal text here>
```

Expected output:

- [ ] <deliverable 1>
- [ ] <deliverable 2>
- [ ] <deliverable 3>

Definition of Done:

| DoD item | Status | Evidence | Notes |
|---|---|---|---|
| Objective is restated in concrete terms. | TODO |  |  |
| Scope and non-goals are explicit. | TODO |  |  |
| Required artifact(s) exist in the right canonical home. | TODO |  |  |
| Owner-facing result matches requested language/tone/detail. | TODO |  |  |

Out of scope / non-goals:

- <not doing this because...>

## 2. Evidence-Backed Checklist

> Rule: checkbox alone is not evidence. Each checked row needs proof.

| Gate | Status | Evidence | Notes |
|---|---|---|---|
| Relevant source/context was read before editing. | TODO |  |  |
| Existing canonical note/file was searched before creating a new one. | TODO |  |  |
| Changes were made in the correct folder/module boundary. | TODO |  |  |
| No unrelated user/worktree changes were reverted or overwritten. | TODO |  |  |
| New/changed durable notes have `parent` and `up::`. | TODO |  |  |
| Index/backlink/discoverability was updated when needed. | TODO |  |  |
| Verification was run at the right scope. | TODO |  |  |
| Residual risk is stated clearly. | TODO |  |  |

## 3. Status Matrix

Use this when the work has multiple deliverables or phases.

| Work item / phase | Status | Evidence | Owner-visible outcome |
|---|---|---|---|
| Frame objective and DoD | TODO |  |  |
| Retrieve required context | TODO |  |  |
| Implement / write / edit | TODO |  |  |
| Verify behavior or artifact | TODO |  |  |
| Update memory/index/session if needed | TODO |  |  |
| Prepare final response | TODO |  |  |

Blocked / partial explanation:

- `PARTIAL`: <what is complete, what is not, why>
- `BLOCKED`: <blocking condition, attempts made, exact input/state needed>

## 4. Evidence Matrix

Commands:

| Command | Status | Important output | Scope proven |
|---|---|---|---|
| `<command>` | TODO |  |  |

Files inspected:

| File/path | Why it matters | Evidence |
|---|---|---|
| `<path>` |  |  |

Files changed:

| File/path | Change summary | Evidence |
|---|---|---|
| `<path>` |  |  |

Artifacts/rendered outputs:

| Artifact | Status | Evidence |
|---|---|---|
| `<artifact>` | TODO |  |

External sources, if any:

| Source | Claim supported | Link / citation |
|---|---|---|
| `<source>` |  |  |

## 5. Residual Risk

Known risk:

| Risk | Impact | Mitigation / next check |
|---|---|---|
| `<risk>` |  |  |

Checks not run:

| Check | Reason not run | Consequence |
|---|---|---|
| `<check>` |  |  |

Do not claim done if:

- [ ] A required check failed.
- [ ] A required check was skipped without a reason.
- [ ] The changed behavior was not exercised.
- [ ] A visual/exported artifact was not opened/rendered when layout matters.
- [ ] The final answer would overstate evidence.

## 6. Change Summary Audit

What changed:

- <bullet summary of actual changes>

What did not change:

- <important non-changes, especially unrelated worktree files>

Behavior before:

- <before state>

Behavior after:

- <after state>

Compatibility / migration notes:

- <none or details>

## 7. Final Answer Draft

Use this draft as the owner-facing final answer. Keep it consistent with the evidence above.

```text
<short answer/status first>

Changed:
- <file/behavior>

Verified:
- <command/result>

Residual risk:
- <risk or "none known">
```

Final-answer safety check:

- [ ] Does not claim tests/build/smoke passed unless listed in Evidence Matrix.
- [ ] Names files/commands accurately.
- [ ] Mentions skipped checks or residual risk.
- [ ] Is concise enough for the owner.

## 8. Second-Brain Routing / Memory Closeout

Session / handoff:

- [ ] Update `Sessions/YYYY-MM-DD-<topic>.md` if the work was non-trivial.
- [ ] Create/update `Handoffs/` if work remains for another session/agent.

Durable memory:

- [ ] Preference discovered? Route to [[Shared/User-Memory/user-preferences]] or Memory-Inbox.
- [ ] Decision made? Route to [[Shared/Decision-Memory/decision-log]].
- [ ] Current focus changed? Update [[Shared/Operating-State/current-state]].
- [ ] Unclear/conflicting memory? Route to [[Shared/Memory-Inbox/memory-inbox]].

Indexes / discoverability:

- [ ] Update destination `_Index.md` if the new artifact should be found later.
- [ ] Add backlinks to project/session/source/decision.
- [ ] Run `sanook index` if retrieval/search should see the change immediately.

Quality loop:

- [ ] Run `sanook brain doctor` if vault structure/config changed.
- [ ] Run `sanook brain review` if memory/context/session/eval hygiene changed.
- [ ] Run `sanook brain eval` if framework/hot-path behavior changed.
- [ ] Update [[Evals/quality-ledger]] for framework/system changes.

## Final Verdict

| Verdict | Choose one | Evidence |
|---|---|---|
| Ready to close | TODO |  |
| Close with caveats | TODO |  |
| Needs more work | TODO |  |
| Blocked | TODO |  |

One-line final state:

> <e.g. Ready to close because X passed; caveat Y remains.>

up:: [[Templates/_Index]]
