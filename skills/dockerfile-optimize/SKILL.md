---
name: dockerfile-optimize
description: Authors and optimizes Dockerfiles for small, secure, fast-building container images: multi-stage builds, minimal/distroless bases, layer caching, non-root users, and .dockerignore. Triggers when writing or reviewing a Dockerfile, shrinking image size, fixing slow builds, or hardening a container image.
when_to_use: ผู้ใช้กำลังเขียน/แก้ Dockerfile, image ใหญ่/build ช้า, อยาก harden container, หรือย้ายไป multi-stage/distroless
---

## When to Use

ใช้ skill นี้เมื่อ:
- เขียน Dockerfile ใหม่ หรือ review Dockerfile ที่มีอยู่
- image ใหญ่เกินไป (เช่น >500MB สำหรับ app เล็ก) — ต้องลด size
- build ช้าทุกครั้งเพราะ cache invalidate ตลอด
- harden container ก่อน deploy (non-root, drop caps, read-only fs)
- migrate single-stage → multi-stage หรือ → distroless

อย่าใช้เมื่อ: ปัญหาอยู่ที่ runtime orchestration (k8s manifests, compose networking) ไม่ใช่ตัว image เอง

## Steps

1. **อ่านบริบทก่อนแก้** — `cat Dockerfile .dockerignore` + ดู lockfile (`package-lock.json` / `go.mod` / `requirements.txt` / `pom.xml`) เพื่อรู้ภาษา/runtime. รัน `docker images <name>` เช็ค size ปัจจุบันเป็น baseline. ถ้ามี image อยู่แล้ว: `docker history <image> --no-trunc | sort -k1` หา layer ที่ใหญ่ที่สุดก่อน

2. **Multi-stage split** — แยก `builder` (มี compiler/dev deps/SDK) ออกจาก `runtime` (มีแค่ binary/artifact + runtime deps). final stage ต้อง `COPY --from=builder` เฉพาะ output ที่จำเป็น เช่น:
   - Go: copy แค่ binary → runtime ใช้ `scratch` หรือ `distroless/static`
   - Node: build ใน `node:20` → copy `dist/` + `node_modules` (prod เท่านั้น) → runtime `node:20-slim` หรือ `distroless/nodejs20`
   - Python: build wheels ใน builder → `pip install --no-index` ใน runtime จาก wheels
   - ตั้งชื่อ stage ชัด (`AS builder`, `AS runtime`) — ห้ามมี stage ลอยที่ไม่ถูก copy

3. **เลือก + pin base image** — เลือกตามลำดับ: `distroless` (no shell, เล็กสุด, ปลอดภัยสุด) > `alpine` (มี shell, glibc-incompat เสี่ยง) > `-slim` (debian, glibc ครบ). **pin ด้วย digest** ไม่ใช่ tag ลอย:
   ```dockerfile
   FROM node:20-slim@sha256:<digest>
   ```
   หา digest: `docker buildx imagetools inspect node:20-slim`. tag เปลี่ยนเงียบได้ digest ไม่เปลี่ยน → reproducible build

4. **Layer ordering + cache mounts** — เรียงจาก "เปลี่ยนน้อย → เปลี่ยนบ่อย": copy manifest+lockfile ก่อน install, แล้วค่อย `COPY . .`:
   ```dockerfile
   COPY package.json package-lock.json ./
   RUN --mount=type=cache,target=/root/.npm npm ci
   COPY . .
   ```
   ใช้ `--mount=type=cache` (BuildKit) สำหรับ package cache: npm `/root/.npm`, pip `/root/.cache/pip`, go `/root/.cache/go-build`+`/go/pkg/mod`, apt `/var/cache/apt`. รวม `RUN apt-get update && apt-get install -y --no-install-recommends ... && rm -rf /var/lib/apt/lists/*` ใน RUN เดียว

5. **Non-root + harden** — สร้าง user แล้วสลับก่อน CMD:
   ```dockerfile
   RUN groupadd -r app && useradd -r -g app -u 10001 app
   USER 10001
   ```
   distroless ใช้ `USER nonroot` หรือ `:nonroot` tag. เพิ่ม `HEALTHCHECK`, ใช้ exec-form `CMD ["app"]` (ไม่ใช่ shell-form), ตั้ง `WORKDIR` ที่ user เขียนได้. caps/read-only fs บังคับตอน runtime: `--read-only --cap-drop=ALL --security-opt=no-new-privileges` (เขียนไว้ใน compose/k8s + comment ใน Dockerfile)

6. **.dockerignore + ลบ build artifacts** — สร้าง/แก้ `.dockerignore` ตัด `.git`, `node_modules`, `*.md`, `.env*`, `dist`, `__pycache__`, `target`, `coverage`, `*.log`, `.DS_Store`, secrets. ตรวจ final stage **ห้ามมี**: compiler, package-manager cache, `.env`, private key, `.git`. secret ที่ใช้ตอน build → ใช้ `RUN --mount=type=secret,id=...` ไม่ใช่ `ARG`/`COPY` (ARG ติดใน history)

7. **Scan + วัด diff** — build แล้ว scan:
   ```bash
   docker build -t app:new .
   trivy image --severity HIGH,CRITICAL app:new   # หรือ grype app:new
   docker images app:new --format '{{.Size}}'
   ```
   รายงาน before/after: size (MB), build time (cold + warm cache), CVE count. แก้ HIGH/CRITICAL ที่มาจาก base image โดยขยับ base version ก่อน

## Common Errors

- **ARG เก็บ secret ติด history** — `ARG TOKEN` + `docker history` เห็นค่าได้ แม้ลบใน layer หลัง. ใช้ `RUN --mount=type=secret` เสมอ
- **alpine + glibc binary พัง** — alpine ใช้ musl; prebuilt wheel/native module ที่ link glibc จะ segfault หรือ `Error loading shared library`. Python/Node native deps → ใช้ `-slim` (debian) ปลอดภัยกว่า
- **`COPY . .` ก่อน install** — ทำให้ทุก source change invalidate layer install → build ช้าทุกครั้ง. ต้อง copy lockfile ก่อนเสมอ
- **cache mount ไม่ทำงาน** — ต้องเปิด BuildKit: `DOCKER_BUILDKIT=1` หรือ `docker buildx build`. ไม่งั้น `--mount` ถูก ignore เงียบ
- **distroless แล้ว debug ไม่ได้** — ไม่มี shell, `docker exec ... sh` จะ fail. ใช้ `:debug` tag ตอน dev หรือ `ctr`/ephemeral debug container แทน
- **USER แล้วเขียน WORKDIR ไม่ได้** — non-root เขียน path ที่ root เป็นเจ้าของไม่ได้ → `EACCES`. `chown` ให้ user หรือ `COPY --chown=app:app`
- **`latest`/floating tag** — build ซ้ำได้ผลต่างกัน + CVE สุ่มเข้ามา. pin digest
- **`apt-get install` แยก RUN จาก update** — apt cache layer เก่า → ติดตั้ง package เวอร์ชันเก่า/พัง. รวม `update && install && rm -rf lists` ใน RUN เดียว
- **ลืม `--no-install-recommends` / `npm ci` แทน `npm install`** — ดึง deps เกินจำเป็น, lockfile ไม่ตรง

## Verify

ก่อนถือว่าเสร็จ ต้องผ่านทุกข้อ (มีหลักฐานรันจริง ไม่ใช่ "แก้แล้ว"):

- [ ] `docker build` ผ่าน (cold cache) — บันทึก size + time
- [ ] build ซ้ำ (warm cache) เร็วขึ้นชัด — source change เล็กไม่ trigger re-install
- [ ] `docker run app:new id` แสดง uid ≠ 0 (non-root จริง)
- [ ] `docker history app:new` — final layers ไม่มี compiler/secret/.git/package cache
- [ ] `trivy image --severity HIGH,CRITICAL` = 0 (หรือ document ตัวที่แก้ไม่ได้ + เหตุผล)
- [ ] container start + health check ผ่าน (`docker run` แล้ว app ตอบได้จริง)
- [ ] size diff: รายงาน before → after เป็น MB + % ลด
- [ ] base image pin ด้วย `@sha256:` digest
