---
tags: [session, session-log, second-brain, ai-sequence]
note_type: session-log
created: 2026-06-17
updated: 2026-06-17
parent: "[[Sessions/_Index]]"
ai_surface: history
---

> Purpose: Record the AI second-brain sequence experiment so future agents can trace the default operating sequence decision.

# 2026-06-17 — AI Second-Brain Sequence Experiment

## Summary

ทดลองเปรียบเทียบวิธีใช้ second-brain ร่วมกับ AI แล้วปรับ framework ให้ใช้ [[Runbooks/ai-second-brain-operating-sequence]] เป็น default sequence.

## What Was Tried

- อ่าน hot-path docs: [[Shared/AI-Context-Index]], [[Vault Structure Map]], [[Shared/Rules/context-assembly-policy]], [[Runbooks/eval-loop]], [[Runbooks/sleep-time-consolidation]]
- สร้างและรัน `Shared/Scripts/ai-second-brain-method-eval.mjs`
- เทียบ 5 methods กับ 7 scenarios ของ vault จริง

## Errors

- ไม่มี command error ระหว่างรัน experiment
- ข้อจำกัดที่พบ: winner ใช้ avg context ~2719 tokens สูงกว่า target ~2k จึงต้องใช้ JIT expansion ไม่ใช่ preload ทุก rule

## Solutions

- บันทึกผลที่ [[Research/2026-06-17-ai-second-brain-method-experiment]]
- สร้าง runbook ใหม่ [[Runbooks/ai-second-brain-operating-sequence]]
- Wire sequence เข้า [[Shared/AI-Context-Index]], `CLAUDE.md`, `SANOOK.md`, `AGENTS.md`, `GEMINI.md`
- อัปเดต indexes, quality ledger, และ current-state

## Key Decisions

- Default method: **Scientific Loop Sequence**
- Sequence: Frame → Retrieve → Role → JIT Rules → Act → Write → Eval → Consolidate
- AI roles: Scientist, Cartographer, Librarian, Operator, Editor, Archivist

## Files Changed

- `second-brain/Shared/Scripts/ai-second-brain-method-eval.mjs`
- `second-brain/Research/2026-06-17-ai-second-brain-method-experiment.md`
- `second-brain/Runbooks/ai-second-brain-operating-sequence.md`
- `second-brain/Shared/AI-Context-Index.md`
- `second-brain/CLAUDE.md`
- `second-brain/SANOOK.md`
- `second-brain/AGENTS.md`
- `second-brain/GEMINI.md`
- `second-brain/Runbooks/_Index.md`
- `second-brain/Research/_Index.md`
- `second-brain/Shared/Scripts/_Index.md`
- `second-brain/Evals/quality-ledger.md`
- `second-brain/Shared/Operating-State/current-state.md`

## Next Steps

- ใช้ sequence ใหม่นี้กับงานจริง 3 session
- หลังครบ 3 session ให้ทบทวน [[Evals/quality-ledger]] และปรับ runbook ถ้าพบ retrieval miss หรือ context bloat

up:: [[Sessions/_Index]]
