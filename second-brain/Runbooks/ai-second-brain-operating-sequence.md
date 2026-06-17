---
tags: [runbook, second-brain, ai, sequence]
note_type: runbook
created: 2026-06-17
updated: 2026-06-17
parent: "[[Runbooks/_Index]]"
evidence:: [[Research/2026-06-17-ai-second-brain-method-experiment]]
---

# Runbook: AI Second-Brain Operating Sequence

> Default sequence for AI agents working with this vault. Evidence: [[Research/2026-06-17-ai-second-brain-method-experiment]].

## Principle

ใช้ **Scientific Loop Sequence**:

**Frame → Retrieve → Role → JIT Rules → Act → Write → Eval → Consolidate**

ห้ามใช้วิธี "โหลดทั้ง vault" และห้ามใช้ session history เป็น source of truth หลัก.

## Sequence

1. **Frame**
   - แปลงคำขอเป็น objective, output, DoD, constraints, risk.
   - ถ้ากว้าง/ข้อมูลดิบ/ไม่รู้ expected output ให้ใช้ interviewer gate ใน `CLAUDE.md`.

2. **Retrieve**
   - อ่าน [[Shared/AI-Context-Index]] ก่อนเสมอ.
   - โหลด hot path เท่าที่จำเป็น: [[USER]], [[Shared/Operating-State/current-state]], [[Shared/User-Memory/user-preferences]], [[Shared/Decision-Memory/decision-log]].
   - ใช้ [[Shared/Rules/context-assembly-policy]] เพื่อวาง context สำคัญไว้หัว/ท้าย.

3. **Role**
   - เลือกบทบาท AI หลักของ phase ปัจจุบันจากตารางด้านล่าง.
   - หนึ่งงานเปลี่ยนบทบาทได้ แต่ต้องรู้ว่าตอนนี้กำลังทำบทบาทไหน.

4. **JIT Rules**
   - ก่อนสร้าง/ย้ายโน้ต: อ่าน [[Vault Structure Map]] + `_Index.md` ของโฟลเดอร์ปลายทาง.
   - ก่อนเขียน durable memory: อ่าน [[Shared/Rules/memory-write-protocol]].
   - ก่อน ingest ของนอก: อ่าน [[Runbooks/ingest-quarantine]].
   - ก่อนงานเทคนิค/release: อ่าน [[Shared/Tech-Standards/verification-standard]].
   - งานหลาย agent: อ่าน [[Shared/Coordination/NOW]] + [[Shared/Coordination/task-board]].

5. **Act**
   - ลงมือทำใน canonical home เดียว.
   - Verify path/link/fact/command ก่อนอ้างผล.
   - ถ้า error ที่กระทบ state: หยุด, ตรวจ diff/state, แล้วรายงาน.

6. **Write**
   - ใช้ operation ชัดเจน: ADD / UPDATE / DELETE / NOOP.
   - Merge, don't append.
   - ทุก durable note ต้องมี `parent`, `up::`, และ link กลับ source/project/session/decision ที่เกี่ยวข้อง.

7. **Eval**
   - งานไม่ trivial ให้รัน [[Runbooks/eval-loop]] แบบย่อ:
     - retrieval hit?
     - grounded?
     - verification passed?
     - มี distractor หรือ stale note ไหม?
   - บันทึกผลใน [[Evals/quality-ledger]] เมื่อเป็นงาน framework/ระบบ/หลาย session.

8. **Consolidate**
   - อย่า consolidate กลางงานถ้าไม่จำเป็น.
   - ตอนจบรอบ/รายสัปดาห์ใช้ [[Runbooks/sleep-time-consolidation]] เพื่อ promote, dedupe, archive stale, และเพิ่ม correction-pairs.

## AI Roles

| Role | ใช้เมื่อ | ทำอะไร | ห้ามทำ |
|---|---|---|---|
| **Scientist** | ต้องตัดสินวิธี/ทดลอง/เปรียบเทียบ | ตั้ง hypothesis, metric, run experiment, สรุปจาก evidence | สรุปจากความรู้สึกโดยไม่มี test/evidence |
| **Cartographer** | ต้องหา/ประกอบ context | เดิน index, map path, ลด distractor, รักษา context budget | โหลดทั้ง vault |
| **Librarian** | ต้องเขียน/ย้าย/จัด memory | classify artifact, merge/update, link graph, metadata | append ซ้ำหรือสร้าง note ผิดบ้าน |
| **Operator** | ต้องแก้ไฟล์/รัน command/build | execute, verify, report command result | ข้าม verification หรือทำ destructive โดยไม่ถาม |
| **Editor** | ต้องส่งผลให้ owner | distill เป็นคำตอบสั้น ชัด มี caveat | wall of text หรือซ่อน uncertainty |
| **Archivist** | จบรอบ/ส่งต่องาน | session log, handoff, quality ledger, consolidation candidate | ย้าย/lบ durable note โดยไม่ถาม |

## Default Role by Task

| Task type | Primary role | Secondary role |
|---|---|---|
| Research / compare methods | Scientist | Cartographer |
| New note / refactor vault structure | Librarian | Cartographer |
| Code / CLI / scripts | Operator | Scientist |
| Ingest web/paste/source | Librarian | Scientist |
| Multi-agent work | Archivist | Operator |
| Owner-facing summary | Editor | Scientist |

## Token Rule

Target core context: ~2k tokens.

ถ้าต้องเกิน:

1. โหลด headings/identifiers ก่อน body.
2. ตัดไฟล์ที่ไม่ได้ตอบ DoD.
3. เขียน scratch ลง [[Shared/Working-Memory/_Index]] แทนการถือทุกอย่างใน context.
4. บอก owner ถ้า evidence ยังไม่พอ.

related:: [[Shared/AI-Context-Index]]
related:: [[Shared/Rules/context-assembly-policy]]
related:: [[Runbooks/eval-loop]]
related:: [[Runbooks/sleep-time-consolidation]]
up:: [[Runbooks/_Index]]
