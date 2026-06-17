---
tags: [session, session-log, second-brain, framework]
note_type: session-log
created: 2026-06-17
updated: 2026-06-17
parent: "[[Sessions/_Index]]"
ai_surface: history
---

> Purpose: Record the AI framework zone additions so future agents can trace why benchmarks, response examples, and context packs were added.

# 2026-06-17 — AI Framework Additional Zones

## Summary

เพิ่ม 3 ชั้นที่ช่วยให้ AI เก่งขึ้นใน framework โดยไม่เพิ่ม root folder ใหม่: benchmarks, response/taste examples, และ context packs.

## What Was Tried

- อ่าน routing contracts ของ [[Evals/_Index]], [[Shared/User-Memory/_Index]], และ [[Shared/Context-Packs/_Index]]
- เติมไฟล์ใหม่ใน zone เดิมแทนการสร้าง root folder ใหม่
- Wire เข้ากับ [[Shared/AI-Context-Index]], [[Runbooks/ai-second-brain-operating-sequence]], `CLAUDE.md`, และ `SANOOK.md`

## Errors

- ไม่มี command error
- ระวังว่า benchmark cases ไม่ใช่ golden fixtures; expected-output fixture ยังต้องอยู่ [[Acceptance/_Index]]

## Solutions

- เพิ่ม [[Evals/second-brain-benchmarks]] สำหรับวัดคุณภาพ AI กับ vault
- เพิ่ม [[Shared/User-Memory/response-examples]] สำหรับ taste/style examples
- เพิ่ม context packs:
  - [[Shared/Context-Packs/second-brain-maintenance]]
  - [[Shared/Context-Packs/coding-release]]
  - [[Shared/Context-Packs/research-to-framework]]
- อัปเดต indexes, quality ledger, current-state, hot path, และ sequence runbook

## Key Decisions

- ไม่เพิ่ม root-level zone ใหม่ เพราะ vault มี `Evals`, `User-Memory`, และ `Context-Packs` รองรับอยู่แล้ว
- ใช้ context packs เฉพาะ task family ที่ชัดเจน; งานอื่นยังใช้ JIT rules ปกติ
- งาน framework ควรใช้ benchmarks ก่อน/หลังแก้เพื่อวัด regression

## Files Changed

- `second-brain/Evals/second-brain-benchmarks.md`
- `second-brain/Shared/User-Memory/response-examples.md`
- `second-brain/Shared/Context-Packs/second-brain-maintenance.md`
- `second-brain/Shared/Context-Packs/coding-release.md`
- `second-brain/Shared/Context-Packs/research-to-framework.md`
- `second-brain/Evals/_Index.md`
- `second-brain/Shared/User-Memory/_Index.md`
- `second-brain/Shared/Context-Packs/_Index.md`
- `second-brain/Shared/AI-Context-Index.md`
- `second-brain/Runbooks/ai-second-brain-operating-sequence.md`
- `second-brain/CLAUDE.md`
- `second-brain/SANOOK.md`
- `second-brain/Evals/quality-ledger.md`
- `second-brain/Shared/Operating-State/current-state.md`

## Next Steps

- ใช้ context packs ใหม่กับงานจริงอย่างน้อย 3 ครั้ง
- เพิ่ม taste examples จาก feedback จริงของเจ้าของ
- ถ้ามี benchmark fail ซ้ำ ให้เพิ่ม correction-pair และปรับ runbook/context pack

up:: [[Sessions/_Index]]
