---
tags: [research, second-brain, ai, experiment]
note_type: research-note
created: 2026-06-17
updated: 2026-06-17
parent: "[[Research/_Index]]"
source::
  - "[[Shared/Scripts/ai-second-brain-method-eval.mjs]]"
  - "https://arxiv.org/abs/2307.03172"
  - "https://arxiv.org/abs/2310.11511"
  - "https://arxiv.org/abs/2404.16130"
---

# AI Second-Brain Method Experiment — 2026-06-17

> คำถามทดลอง: วิธีจัด second-brain แบบไหนทำให้ AI ใช้งาน vault ได้แม่นที่สุด โดยไม่โหลด context เกินจำเป็น?

## Hypothesis

วิธีที่ดีที่สุดไม่ใช่การให้ AI โหลดทั้ง vault หรือจำจาก session log แต่คือ:

**Single Retrieval Path + JIT Task Rules + Explicit Write Routing + Eval/Consolidation Loop**

ชื่อที่ใช้ใน framework: **Scientific Loop Sequence**.

## Method

รันสคริปต์:

```bash
node second-brain/Shared/Scripts/ai-second-brain-method-eval.mjs second-brain
```

สคริปต์เทียบ 5 วิธี:

| Method | แนวคิด |
|---|---|
| Session-log only | ใช้ session history เป็น memory หลัก |
| Folder map only | ใช้ `Vault Structure Map.md` และ index ปลายทาง |
| Single retrieval index | เริ่มจาก `Shared/AI-Context-Index.md` |
| Index + JIT context policy | single index + context assembly + โหลดเฉพาะไฟล์จำเป็น |
| Scientific loop sequence | single index + JIT + write protocol + eval + sleep consolidation + coordination |

Scenarios ที่ใช้วัด:

1. เริ่มงานกับ AI โดยไม่หลุด source of truth
2. สร้าง/แก้ durable note ให้ถูกที่และค้นเจอภายหลัง
3. บันทึก preference/decision/fact โดยไม่ append ซ้ำ
4. นำข้อมูลภายนอกเข้า vault แบบปลอด prompt injection
5. ทำ sleep-time consolidation และปิด loop ความจำ
6. กันหลาย agent ชนกันและส่งต่องานได้
7. งานเทคนิคที่ต้อง verify ก่อนสรุป

Metric:

- **File coverage**: context มีไฟล์ที่ scenario ต้องใช้ไหม
- **Capability coverage**: วิธีนั้นมี retrieval/routing/eval/memory/coordination ครบไหม
- **Token economy**: context เฉลี่ยยังใกล้ budget หรือไม่

## Results

| Rank | Method | Score | File Coverage | Capability Coverage | Avg Tokens |
|---:|---|---:|---:|---:|---:|
| 1 | Scientific loop sequence | 97.3 | 100% | 100% | ~2719 |
| 2 | Index + JIT context policy | 62.7 | 64% | 43% | ~2108 |
| 3 | Single retrieval index | 40.6 | 39% | 18% | ~1683 |
| 4 | Folder map + destination indexes | 21.1 | 13% | 18% | ~2530 |
| 5 | Session-log only | 16.4 | 6% | 10% | ~245 |

## Interpretation

**Winner: Scientific Loop Sequence.**

เหตุผล:

- ครอบคลุมงาน AI กับ second-brain ได้ครบทุก scenario
- ลด hallucination เพราะเริ่มจาก single source of truth แล้วค่อย expand context
- ลด memory rot เพราะ write operation ต้องเลือก ADD/UPDATE/DELETE/NOOP
- ลด context rot เพราะใช้ `context-assembly-policy` ก่อนโหลด task rules
- มี feedback loop จริงผ่าน `eval-loop` และ `sleep-time-consolidation`

ข้อควรระวัง:

- Avg tokens ~2719 สูงกว่า target ~2k
- บาง scenario สูงเพราะต้องโหลดไฟล์ใหญ่ เช่น `Vault Structure Map.md` และ ingest rules
- ดังนั้น implementation ต้องใช้แบบ **JIT**: โหลด heading/index ก่อน, expand body เฉพาะเมื่อจำเป็น, และอย่า preload ทุก rule ทุกครั้ง

## Literature Anchor

- Lost in the Middle สนับสนุนว่า context ยาวและตำแหน่งกลางทำให้ retrieval/usefulness ลดลง จึงควรวาง load-bearing context ไว้หัว/ท้าย
- Self-RAG สนับสนุน retrieve-then-critique/evaluate loop แทนการตอบจาก memory ล้วน
- GraphRAG สนับสนุนการจัดความรู้เป็น graph/index แทนการกองเอกสารแบบ flat

## Decision

ใช้ **Scientific Loop Sequence** เป็น default AI operating sequence ของ vault:

1. Frame objective/DoD
2. Retrieve hot context via `Shared/AI-Context-Index.md`
3. Select AI role for the current phase
4. Load task-specific rules JIT
5. Act and verify
6. Write memory with explicit operation
7. Eval if non-trivial
8. Consolidate later via sleep-time loop

related:: [[Runbooks/ai-second-brain-operating-sequence]]
up:: [[Research/_Index]]
