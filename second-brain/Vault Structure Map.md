---
tags: [index, durable-index, folder-roles]
note_type: durable-index
created: {{DATE}}
updated: {{DATE}}
parent: "[[Home]]"
ai_surface: hot
---
<!-- ⚠ sync กับ src/brain.ts FOLDERS[] — แก้ทั้งสองที่เสมอ (มี test กัน drift) -->

# Vault Structure Map — Where Everything Goes

> แผนที่โฟลเดอร์ครบทุกอัน: role + ใส่อะไร + **ห้ามใส่อะไร** · **อ่านก่อนสร้าง/ย้ายโน้ตทุกครั้ง** (one artifact = one canonical home)

## §1 Quick Routing (90% fast path)

| ฉันมี... | ใส่ที่ | filename |
|---|---|---|
| งานจริง/โปรเจค | `Projects/<proj>/` | overview·context·current-state |
| log งานที่ทำ | `Sessions/` | `YYYY-MM-DD-<topic>.md` |
| preference ของเจ้าของ | `Shared/User-Memory/` | |
| การตัดสินใจสำคัญ | `Shared/Decision-Memory/` | |
| priority/current focus เปลี่ยน | `Shared/Operating-State/current-state.md` | update existing |
| ยังไม่ชัด/ขัดกัน | `Shared/Memory-Inbox/` | |
| content จากเว็บ/paste | `Intake/_Quarantine/` | (scan ก่อน) |
| ต้นฉบับดิบ read-only | `Intake/Raw Sources/` | |
| finding ที่มี source | `Research/` | ใส่ `source::` |
| scratch ชั่วคราวระหว่างงาน | `Shared/Working-Memory/` | ลบทิ้ง/โปรโมทหลังจบ |
| script ที่ผ่าน test | `Skills/` | |
| how-to อ่านแล้วทำเอง | `Runbooks/` | |
| กลยุทธ์ที่ปรับดีขึ้น | `Playbooks/` | |
| fixture expected output | `Acceptance/` | input→expected |
| pre/postflight gate | `Checklists/` | ticklist |
| page ของคน/องค์กร/concept | `Entities/` | |
| bug | `Bugs/` | `YYYY-MM-DD-<bug>.md` |
| bug ระบบ/OS/toolchain | `Bugs/System-OS/` | `YYYY-MM-DD-<bug>.md` |
| ส่งมอบงานค้าง | `Handoffs/` | |
| multi-agent task card | `Shared/Coordination/task-board/` | `<id>.md` |

## §2 Full Reference (ครบทุกโฟลเดอร์ — ใส่อะไร / ห้ามใส่)

### Core
| Folder | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `Projects/` | งานจริง 1 โฟลเดอร์=1 โปรเจค | deliverable, overview/context/current-state ของ project | ความรู้ทั่วไป (→Learning), log (→Sessions) |
| `Sessions/` | log งานลงวันที่ (flat) | session log 7 หัวข้อ | code/config, subfolder |
| `Intake/` | จุดรับของใหม่ก่อนกระจาย | task framing, raw input ที่รอจัด | durable knowledge (จัดเข้าปลายทางก่อน) |
| `Intake/_Quarantine/` | external ที่ยัง untrusted | web clip/paste/email ก่อน scan injection | content ที่ scan ผ่านแล้ว |
| `Intake/Raw Sources/` | ต้นฉบับ immutable | original หลัง scan (read-only) | โน้ตที่ derived/สรุป |
| `Skills/` | unit ที่ executable + verified | script/command ที่รัน test ผ่าน | prose how-to (→Runbooks), unverified (→Memory-Inbox) |
| `Runbooks/` | prose how-to | ขั้นตอน setup/deploy/maintain | runnable unit (→Skills) |
| `Templates/` | แม่แบบโน้ต | template ไว้ instantiate | โน้ตจริง |
| `Bugs/` | bug reproducible (global flat) | bug report + link กลับ project | bug ของ project ที่ไม่ reproduce |
| `Bugs/System-OS/` | bug ระบบ/OS/toolchain | OS, shell, package manager, permission, filesystem, app-runtime bugs | bug ของ project เฉพาะ |
| `Handoffs/` | ส่งมอบงานค้าง (snapshot) | state + next steps ส่งต่อ | live coordination (→Coordination) |

### Direction
| Folder | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `Goals/` | objective finite (มีวันจบ) | north-star + objective รายไตรมาส/ปี | live status (→Operating-State) |
| `Areas/` | โดเมนต่อเนื่อง (PARA) | brand/trading/content ฯลฯ | งานที่มีวันจบ (→Projects/Goals) |

### Knowledge pipeline
| Folder | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `Research/` | finding อิงแหล่งนอก | สรุปมี `source::` + market scan | ความรู้ที่ตัวเองกลั่น (→Learning) |
| `Learning/` | กลั่น/deep-dive เอง | topic MOC ที่ไม่มี external source | finding อิงแหล่ง (→Research) |
| `Distillations/` | หลักการ evergreen | principle ที่นิ่งแล้ว (≥3 ครั้ง) | สิ่งที่ยังเปลี่ยน (→Playbooks) |
| `Retrospectives/` | reflection (event) | what worked/failed หลังงาน | review ตามรอบ (→Reviews) |
| `Reviews/` | review (cadence) | weekly/monthly + vault health | reflection รายงาน (→Retrospectives) |
| `Traces/` | reasoning chain ยาว | การสืบสวนหลายขั้น | คำตอบสั้น (→โน้ตปกติ) |
| `Prompts/` | prompt text (input ให้ LLM) | prompt/template หยิบมารัน | fixtures (→Acceptance), tactic (→Playbooks) |
| `Acceptance/` | golden fixtures | input→expected-output ตัดสิน done | gate ticklist (→Checklists), runner (→Evals) |
| `Checklists/` | preflight/postflight gate | ticklist ก่อน-หลังลงมือ | expected output (→Acceptance) |

### Frontier loops
| Folder | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `Playbooks/` | กลยุทธ์ที่ปรับดีขึ้น (how-to-decide) | tactic/heuristic ที่ดีขึ้นจากผลจริง | prompt text (→Prompts), runnable (→Skills) |
| `Evals/` | quality loop (runner) | error-analysis + self-eval + retrieval-eval | golden case เอง (→Acceptance) |
| `Entities/` | page ของ entity (bi-temporal) | คน/องค์กร/concept canonical | event log (→Sessions) |

### Shared — สมองกลาง
| Folder | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `Shared/` | hub: memory+rules+coordination | เข้าผ่าน AI-Context-Index | โน้ตงานทั่วไป |
| `Shared/Operating-State/` | live status ตอนนี้ | current-state + health/queue | objective (→Goals) |
| `Shared/User-Memory/` | AI เรียนรู้เรื่องเจ้าของ (mutable) | preference/response-example | identity static (→User-Persona) |
| `Shared/Decision-Memory/` | decision ที่ AI บันทึก | decision locked + supersedes | ground truth คน (→Core-Facts) |
| `Shared/Memory-Inbox/` | candidate ยังไม่ชัด | observation รอ promote (clear weekly) | durable ที่ชัดแล้ว (→ปลายทาง) |
| `Shared/Rules/` | กฎ operating always-on | memory/frontmatter/context-assembly | how-to ทำงาน (→Runbooks) |
| `Shared/Tech-Standards/` | มาตรฐานเทคนิค | MCP/stack/DoD/verification | กฎ memory/format (→Rules) |
| `Shared/Core-Facts/` | ground truth คนเขียน (read-only) | invariant ที่ AI ห้ามแก้ | decision ที่ AI ตัด (→Decision-Memory) |
| `Shared/Coordination/` | live multi-agent baton | NOW.md + task-board + registry | เอกสารส่งมอบ (→Handoffs) |
| `Shared/Coordination/task-board/` | file-Kanban task cards | task ต่อชิ้นงาน มี `claimed_by`/`status` | session narrative หรือ handoff snapshot |
| `Shared/Working-Memory/` | scratchpad 1 task (ลบได้) | ของชั่วคราวระหว่างทำงาน | อะไรที่จะเก็บ (→Memory-Inbox) |
| `Shared/User-Persona/` | identity static (read-only) | บทบาท/ค่านิยม/ภาษา/timezone | สิ่งที่ AI เรียนรู้ (→User-Memory) |
| `Shared/Provenance/` | source ledger | บรรทัด ingest ต่อแหล่ง | โน้ต derived (ใส่ `source::` แทน) |
| `Shared/Archive/` | cold storage (ไม่ลบ) | โน้ต stale/retired ออกจาก retrieval | ของที่ยังใช้ |
| `Shared/Scripts/` | automation maintenance | lint/graph-audit/metrics script | one-off retired (→Scripts-Archive) |
| `Shared/Scripts-Archive/` | สคริปต์ one-off retired | script เก่า (ประวัติ) | script ที่ยังใช้ (→Scripts) |
| `Shared/mcp-servers/` | vendored MCP server bundle | code/README ของ MCP server | config การต่อ (→Tech-Standards) |
| `Shared/Context-Packs/` | full-context bundle | pack รวม context พร้อมโหลด | โน้ตเดี่ยว |
| `Shared/Context7-Docs/` | cached lib doc (regenerable) | cache context7/lib doc | durable knowledge (→Learning) |
| `Shared/AI-Threads/` | saved AI reasoning trail | thread review/resume/promote | durable decision (→Decision-Memory) |
| `Shared/Prompting/` | prompt-engineering pattern | pattern การเขียน prompt | prompt asset (→Prompts) |
| `Shared/Glossary/` | vocabulary กลาง | term + นิยาม | entity page (→Entities) |
| `Shared/Assets/` | รูป/logo/binary | image/logo/asset | โน้ต .md |

### AI agent config / vendor (root-level)
| Path | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `HERMES.md` | Hermes CLI context adapter | กฎย่อเฉพาะ `hermes` / `hermes chat` ที่ชี้กลับ `CLAUDE.md` | durable note หรือ gateway/desktop setup |
| `.agents/` `.agents/skills/` | skill folders (SKILL.md) | SKILL.md ที่ agent โหลด on-demand | prose how-to (→Runbooks) |
| `.agents/workflows/` | workflow guides | multi-step orchestration ที่ทำซ้ำ | one-off task |
| `copilot/` | vendor export (review/promote) | export จาก Copilot | durable (promote เข้า durable layer) |

### Optional / Machine-local
| Folder | Role | ใส่ที่นี่ | ห้ามใส่ |
|---|---|---|---|
| `Tools/` | utility เฉพาะเครื่อง/vault | local helper, wrapper, utility ที่ยังใช้ | durable knowledge หรือ verified skill |

## §3 Decision Rules (เคสกำกวม)

- **durable vs throwaway:** ลบได้→`Working-Memory` · ยังไม่ชัด→`Memory-Inbox` · ชัด+ถาวร→`Shared/*` ปลายทาง
- **trusted vs untrusted:** ของนอกเข้า `Intake/_Quarantine` จนกว่าจะ scan ผ่าน
- **verified vs unverified script:** ผ่าน verification command→`Skills` · ไม่ผ่าน→`Memory-Inbox`
- **tactic vs principle:** ปรับดีขึ้นเรื่อยๆ→`Playbooks` · นิ่งแล้ว→`Distillations`
- **sourced vs self-derived:** มี external source→`Research` · กลั่นเอง→`Learning`
- **finite vs ongoing:** มีวันจบ→`Goals` · ไม่จบ→`Areas`
- **event vs cadence vs metric:** หลังงาน→`Retrospectives` · ตามรอบ→`Reviews` · วัดคุณภาพ→`Evals`
- **system bug vs project bug:** OS/toolchain/runtime กว้างๆ→`Bugs/System-OS` · bug ของงานหนึ่ง→`Bugs`/`Projects/<proj>`
- **coordination task vs narrative:** claimable task card→`Shared/Coordination/task-board` · เล่า session→`Sessions` · ส่งต่อ state→`Handoffs`

## §4 Footer

> source of truth — sync กับ `src/brain.ts` FOLDERS[] · แก้พร้อมกันเสมอ

up:: [[Home]]
