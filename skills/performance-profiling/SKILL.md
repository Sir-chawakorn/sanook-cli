---
name: performance-profiling
description: Diagnoses and fixes runtime performance problems — finds hotspots via profiling/measurement, then fixes N+1 queries, unnecessary allocations, blocking IO, and algorithmic complexity, proving the gain with before/after numbers. Use when something is measurably slow or resource-heavy.
when_to_use: endpoint/job ช้า, memory/CPU พุ่ง, query ช้า, bundle ใหญ่ — มีอาการ perf ที่วัดได้
---

## When to Use

ใช้เมื่อมี **อาการ perf ที่วัดเป็นตัวเลขได้** อย่างน้อยหนึ่งอย่าง:
- endpoint/job ช้า (latency สูง, p95/p99 พุ่ง, timeout)
- memory/CPU พุ่งหรือ OOM, GC ถี่
- DB query ช้า, connection pool หมด
- bundle/build/startup ใหญ่หรือนาน

อย่าใช้ skill นี้ถ้ายังไม่มีตัวเลขยืนยันว่าช้า — ไปวัดให้ได้ baseline ก่อน มิฉะนั้นคือ premature optimization. ถ้าโจทย์คือ "correctness bug" ไม่ใช่ "speed/resource" → ใช้ skill อื่น.

**กฎเหล็ก: measure ก่อน optimize เสมอ. ห้าม optimize จากการเดา.**

## Steps

1. **กำหนด target ที่วัดได้ก่อนเริ่ม.** เขียนเป็นตัวเลข เช่น "p95 ของ `GET /orders` < 200ms" หรือ "RSS < 512MB ที่ 1k req/s". ระบุ workload/dataset ที่จะใช้ reproduce (input size, concurrency, env). ถ้าไม่มี repro ที่เสถียร ให้สร้างก่อน (script/benchmark/load test) — เพราะตัวเลขที่ noisy เชื่อไม่ได้.

2. **วัด baseline แล้วหา hotspot จริงด้วย profiler — ไม่ใช่อ่านโค้ดแล้วเดา.** เลือกเครื่องมือตาม layer:
   - **CPU/wall time (app):** sampling profiler ของภาษานั้น (เช่น `py-spy`/`cProfile`, `--prof`+flamegraph / `clinic flame` (Node), `pprof` (Go), async-profiler (JVM), `perf` + flamegraph). อ่าน **flame graph** หา frame ที่กว้างสุด (กิน wall/CPU มากสุด).
   - **DB:** `EXPLAIN ANALYZE` บน query ที่ต้องสงสัย ดู rows, Seq Scan, nested loop, actual time. เปิด slow query log / `pg_stat_statements` หา query ที่กินเวลารวมมากสุด.
   - **N+1:** ดู query log/APM count — ถ้าจำนวน query โตตาม N ของผลลัพธ์ = N+1.
   - **Memory:** heap snapshot / heap profiler (`take_heapsnapshot`, `memory_profiler`, `pprof -alloc_space`, Go `pprof heap`) เทียบ 2 snapshot หา object ที่โตเรื่อยๆ (leak) หรือ allocation hotspot.
   - **Async/blocking IO:** หา blocking call ใน hot path (sync IO ใน event loop, lock contention, sequential awaits ที่ควร parallel).
   - **Frontend/bundle:** bundle analyzer หา module ใหญ่; Lighthouse/perf trace หา long task, layout thrash.

3. **จัดอันดับ candidate ตาม impact, แก้ทีละจุดบนสุด.** เรียงตาม "% ของเวลา/หน่วยทรัพยากรที่จุดนั้นกิน" จาก profiler. แก้จุดที่กิน 60% ก่อนจุดที่กิน 2% เสมอ. **แก้ทีละ change** เพื่อ attribute การปรับปรุงได้ชัด — อย่าแก้ 5 อย่างพร้อมกันแล้วไม่รู้อันไหนช่วย.

4. **เลือก fix ตาม root cause (จากแพงไปถูกในแง่ effort/maintainability):**
   - **N+1 query** → batch (`IN (...)` / `WHERE id = ANY`), `JOIN`, eager-load (include/preload/dataloader). ลด round-trip ไม่ใช่แค่ทำ query เร็วขึ้น.
   - **Algorithmic** → O(n²)→O(n) ด้วย hash map/set แทน nested loop; O(n)→O(log n)/O(1) ด้วย index/sorted structure. นี่ให้ผลโตตาม N — มักคุ้มสุด.
   - **Missing DB index** → เพิ่ม index ให้ตรง predicate/sort/join (เช็คด้วย `EXPLAIN` ว่ามันถูกใช้จริงหลังเพิ่ม). ระวัง write overhead.
   - **Allocation/GC** → ลด allocation ใน hot loop (reuse buffer, ตัด intermediate copy/`map().filter().map()` chain บน array ใหญ่, streaming แทน load-all-in-memory).
   - **Blocking/serial IO** → parallelize (`Promise.all`/goroutine/async gather) งานที่ independent; ย้าย blocking call ออกจาก hot path/event loop.
   - **Repeated expensive compute** → cache/memoize (กำหนด invalidation ชัด), หรือ precompute.
   - **Over-fetching** → select เฉพาะ column ที่ใช้, paginate, lazy-load, defer.

5. **วัดหลังแก้ด้วย repro/profiler เดิม แล้วรายงาน before/after เป็นตัวเลข.** เช่น `p95 820ms → 140ms (-83%)`, `queries/req 312 → 3`, `RSS 1.2GB → 380MB`. ถ้าตัวเลขไม่ดีขึ้นจริง → revert การแก้นั้น (มันไม่ใช่ hotspot จริง) แล้วกลับไป step 3.

6. **รัน regression test/lint ให้เขียว.** confirm ว่าไม่ได้แลก correctness เพื่อ speed. ถ้าไม่มี test ครอบ behavior ที่เพิ่งแก้ → เขียนเพิ่มก่อน merge.

## Common Errors / Gotchas

- **เดา hotspot จากการอ่านโค้ด.** จุดที่ "ดูช้า" มักไม่ใช่จุดที่กินเวลาจริง. ต้องมี profiler/EXPLAIN ยืนยัน — ทุกครั้ง.
- **วัดใน dev/debug build หรือ dataset เล็ก.** debug mode, source map, dataset 10 แถวให้ profile คนละเรื่องกับ prod. วัดบน build + data size ใกล้ prod.
- **Cold start / JIT / cache warm-up บิดเบือนเลข.** ทิ้ง run แรกๆ (warmup), วัดหลายรอบเอา median/p95 ไม่ใช่ค่าครั้งเดียวที่ noisy.
- **`EXPLAIN` (planner estimate) ≠ `EXPLAIN ANALYZE` (actual).** ดู actual time + actual rows; estimate โกหกได้ถ้า stats เก่า (`ANALYZE` table ก่อน).
- **แก้แล้ว query เร็วแต่ throughput แย่ลง** — เพิ่ม index ทำ read เร็วแต่ write ช้า/ใหญ่ขึ้น. ดู trade-off ทั้งระบบ ไม่ใช่แค่ตัวเลขเดียว.
- **Cache ที่ไม่มี invalidation** = correctness bug รอเวลา. มี cache ต้องตอบได้ว่า invalidate เมื่อไหร่.
- **Micro-optimize จุดที่กิน 1%.** เปลี่ยน `for` เป็น `while`, ตัด `+` ทีละนิด ในจุดที่ไม่ใช่ hotspot = เสียเวลา + โค้ดอ่านยากขึ้น ไม่ได้อะไร.
- **แลก correctness เพื่อ speed** — ลด assertion, ข้าม validation, อ่าน stale data โดยไม่ตั้งใจ. ห้ามเด็ดขาด: เร็วแต่ผิด = พัง.
- **N+1 ที่ซ่อนอยู่หลัง ORM lazy-load/serializer.** มองไม่เห็นในโค้ดตรงๆ — ต้องดู query log จริง.

## Verify

ถือว่าสำเร็จเมื่อครบทุกข้อ:
- [ ] มี **before/after เป็นตัวเลข** จาก repro/profiler เดิม และผ่าน target ที่ตั้งไว้ใน step 1
- [ ] การปรับปรุงมาจาก hotspot จริงที่ profiler ชี้ (อธิบายได้ว่าทำไมมันช่วย ไม่ใช่ "ลองแล้วเร็วขึ้น")
- [ ] regression test + lint เขียว — correctness ไม่ถูกแลก
- [ ] ไม่มี trade-off ที่ซ่อน (write/memory/maintainability แย่ลงโดยไม่ได้ตั้งใจ) หรือถ้ามีก็ระบุชัดและยอมรับได้
- [ ] วัดบน build/dataset ใกล้ prod ไม่ใช่ dev/toy data
