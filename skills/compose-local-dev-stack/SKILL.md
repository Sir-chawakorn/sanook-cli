---
name: compose-local-dev-stack
description: Wires a local multi-service development stack with Docker Compose — app plus backing datastores (Postgres/Redis/Kafka), dependency-ordered healthchecks (depends_on condition: service_healthy), pinned images + named volumes, seed/init scripts, hot-reload bind mounts, profiles, and one-command up/down/reset via a Makefile.
when_to_use: An app needs real local backing services (db, cache, queue) and "start everything" is fragile, slow, or undocumented. Not the dev container the editor runs in (setup-devcontainer-env), not the shippable app image (dockerfile-optimize), not cluster deployment (k8s-manifest-review).
---

## When to Use

Reach for this when the request is about **standing up the app's runtime dependencies on a laptop**, reproducibly, with one command:

- "Get Postgres + Redis + the API running locally so I can develop"
- "The onboarding doc says `docker compose up` but it races / half the services aren't ready"
- "Add Kafka (or a queue, or a second DB) to the local stack"
- "I want hot reload — edit code, see it without rebuilding the image"
- "Seed the dev database automatically" / "give me a clean-slate reset command"

NOT this skill:
- The container the editor/agent itself runs inside (devcontainer.json, features, VS Code attach) → setup-devcontainer-env
- Shrinking/hardening the **production** image (multi-stage, distroless, non-root) → dockerfile-optimize
- Deploying these services to a cluster (Deployments, probes, resource limits, Helm) → k8s-manifest-review
- Pinning the *host* language/tool versions (node/python/go via asdf/mise/`.tool-versions`) → pin-toolchain-versions
- A schema change's lock/data-loss safety → db-migration-safety (this skill only *runs* migrations on start)

## Steps

1. **One file, services as the unit. Pin every tag, name every volume.** Floating `:latest` makes the stack non-reproducible and breaks silently on pull; bare anonymous volumes orphan and lose data on `down`. `compose.yaml` (the modern name — drop the `version:` key, it's obsolete):

   ```yaml
   name: myapp
   services:
     db:
       image: postgres:16.4-alpine            # pin minor; never :latest
       environment:
         POSTGRES_USER: app
         POSTGRES_PASSWORD: app
         POSTGRES_DB: app
       volumes:
         - pgdata:/var/lib/postgresql/data     # named -> survives `down`
         - ./db/init:/docker-entrypoint-initdb.d:ro  # runs ONCE on empty volume
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U app -d app"]
         interval: 3s
         timeout: 3s
         retries: 20
         start_period: 5s
       ports: ["5432:5432"]

     redis:
       image: redis:7.4-alpine
       command: ["redis-server", "--save", "", "--appendonly", "no"]  # ephemeral cache
       healthcheck:
         test: ["CMD", "redis-cli", "ping"]
         interval: 3s
         timeout: 2s
         retries: 20

     app:
       build: { context: ., target: dev }       # dev stage, not prod
       command: ["npm", "run", "dev"]            # hot-reload command, overrides Dockerfile CMD
       depends_on:
         db:    { condition: service_healthy }   # waits for healthcheck, not just "started"
         redis: { condition: service_healthy }
       environment:
         DATABASE_URL: postgres://app:app@db:5432/app   # use service name, not localhost
         REDIS_URL: redis://redis:6379
       volumes:
         - ./src:/app/src                        # bind mount -> edits reflect live
         - /app/node_modules                     # anon vol masks host node_modules
       ports: ["3000:3000"]

   volumes:
     pgdata:
   ```

2. **Order startup with `depends_on: condition: service_healthy` — never bare `depends_on`.** Bare `depends_on` only waits for the container to *start*, not to be *ready*; the app then connects to a Postgres still replaying WAL and crash-loops. The gate is the **healthcheck on each backing service**. Pick the right probe per service:

   | Service | Healthcheck test | Why not just TCP |
   |---|---|---|
   | Postgres | `pg_isready -U $USER -d $DB` | port opens before it accepts queries |
   | MySQL | `mysqladmin ping -h localhost` | same early-port problem |
   | Redis | `redis-cli ping` → `PONG` | trivial, do it |
   | Kafka (KRaft) | `kafka-broker-api-versions --bootstrap-server localhost:9092` | broker advertises before it serves metadata |
   | RabbitMQ | `rabbitmq-diagnostics -q ping` | mgmt port lies about readiness |
   | Elasticsearch | `curl -fsS localhost:9200/_cluster/health?wait_for_status=yellow` | green never comes single-node |
   | App migrations | a one-shot `migrate` service the app `depends_on` (condition: `service_completed_successfully`) | keeps schema setup off the app's hot path |

   Tune `retries × interval ≥ real cold-start time` (Kafka/ES need `start_period: 20s`+) or healthy never arrives and the dependents abort.

3. **Seed once via `docker-entrypoint-initdb.d`; run migrations every start via a one-shot service.** The init dir (`*.sql`/`*.sh`, alphabetical) runs **only when the data volume is empty** — perfect for extensions, roles, and static seed (`01-schema.sql`, `02-seed.sql`). It does **not** re-run after the volume exists, so never put evolving migrations there. Migrations belong in a dedicated short-lived service the app waits on:

   ```yaml
     migrate:
       build: { context: ., target: dev }
       command: ["npm", "run", "migrate:deploy"]   # or: alembic upgrade head / flyway migrate
       depends_on: { db: { condition: service_healthy } }
       restart: "no"
   ```
   Then `app.depends_on.migrate.condition: service_completed_successfully`. Idempotent migration tools make this safe to run on every `up`.

4. **Hot reload = bind mount source + a dev `command` + a watcher, not a rebuild.** Bind `./src:/app/src` and run the dev server (`npm run dev`/`uvicorn --reload`/`air`/`nodemon`). Mask installed deps with an **anonymous volume** (`- /app/node_modules`) so the host's empty/mismatched dir doesn't shadow the image's. Build the image from a **`dev` stage** (`target: dev`) that includes dev deps and the watcher — keep the lean prod stage for shipping (that's dockerfile-optimize's job). Changing `package.json`/`requirements.txt` still needs a rebuild; code does not.

5. **Split config: committed `compose.yaml` + `.env` + an uncommitted `compose.override.yml`.** Compose **auto-merges** `compose.override.yml` on top of `compose.yaml` with no `-f` flag — put local-only tweaks there (extra port bindings, mounted debug tools, `DEBUG=1`) and gitignore it so teammates' hacks don't collide. Variables interpolate from `.env` (committed `.env.example`, real `.env` gitignored). Never hardcode host-specific ports or paths in the base file.

6. **Gate optional services behind `profiles`.** Tag heavy/rarely-needed services (Kafka, a second DB, mailhog, a metrics stack) with `profiles: ["kafka"]` so a plain `docker compose up` starts only the core stack. Opt in with `docker compose --profile kafka up`. Keeps the default path fast; a service with no `profiles` always runs.

7. **Use a fixed internal network + stable host ports, and talk service-to-service by name.** Compose gives you a default bridge network where services resolve each other by **service name** (`db`, `redis`) — the app must use `db:5432`, never `localhost:5432` (localhost inside the app container is the app). Publish stable host ports (`5432:5432`) only for tools you run on the host (psql, a GUI). Collisions with a host Postgres → remap the **host** side (`5433:5432`), never the container side.

8. **Make one-command verbs in a `Makefile` (or `Taskfile.yml`) so nobody memorizes flags.** `up` must block until healthy; `reset` must wipe volumes:

   ```makefile
   up:      ## start core stack, wait until healthy
   	docker compose up -d --wait
   down:    ## stop, keep data
   	docker compose down
   reset:   ## stop AND wipe volumes -> clean slate
   	docker compose down -v --remove-orphans
   	docker compose up -d --wait
   logs:    ## tail everything
   	docker compose logs -f --tail=100
   ps:
   	docker compose ps
   ```
   `--wait` makes `up` exit non-zero if any service never goes healthy — that's your machine-checkable gate. `down -v` is the *only* thing that deletes data; keep it on `reset` alone so `down` is always safe.

## Common Errors

- **Bare `depends_on:` (list form).** Waits for container *start*, not readiness; the app races the DB and crash-loops on cold boot. Use the map form with `condition: service_healthy`.
- **No `healthcheck` on a backing service.** Then `service_healthy` has nothing to gate on and Compose errors or treats it as instantly up. Every service you depend-on needs a real probe (table in step 2).
- **App connects to `localhost` instead of the service name.** `localhost` inside the app container is the app itself — connection refused. Use `db`/`redis`/`kafka` (the service names) in `DATABASE_URL`/`REDIS_URL`.
- **Anonymous/missing volume on a datastore.** `docker compose down` orphans the anonymous volume and the next `up` starts empty; data "randomly" vanishes. Always name datastore volumes and declare them under `volumes:`.
- **Expecting `docker-entrypoint-initdb.d` to re-run.** It runs **only on an empty data volume**. Edited a seed file and "nothing happened"? The volume already exists — `docker compose down -v` (or `make reset`) to re-init. Don't put live migrations there.
- **`start_period` too short for Kafka/Elasticsearch.** They take 20–60s to be ready; with the default `start_period: 0s` and few retries, healthy never arrives and dependents abort. Set `start_period: 30s` and enough `retries`.
- **`:latest` / unpinned tags.** A teammate pulls a newer Postgres major, the data dir format changes, the volume won't mount. Pin to a minor tag (`postgres:16.4-alpine`).
- **Host port already in use (`bind: address already in use`).** A host Postgres or a previous stack holds 5432. Remap the host side only (`5433:5432`); changing the container side breaks intra-network DNS.
- **Host `node_modules`/`venv` shadowing the image's via the source bind mount.** App can't find deps or loads wrong-arch binaries. Add the anonymous-volume mask (`- /app/node_modules`) *after* the source bind.
- **Secrets committed in `compose.yaml`.** Real credentials in the base file leak to git. Keep them in the gitignored `.env`; commit only `.env.example` with placeholders.

## Verify

1. **Cold up from nothing:** `make reset` (wipes), then `make up`. The command must **exit 0** — `--wait` fails the command if any service is unhealthy. `docker compose ps` shows every core service `running (healthy)`.
2. **Ordering held:** check `docker compose logs migrate` / app — the app started its first DB query *after* `db` was healthy and migrations completed, with **no** connection-refused retries in the log.
3. **Seeded:** `docker compose exec db psql -U app -d app -c "select count(*) from <seeded_table>;"` returns the expected non-zero count without any manual step.
4. **Hot reload:** with the stack up, edit a source file under the bind mount → the app reloads and serves the change **without** `docker compose build` or restart.
5. **Reachability:** a host tool hits the published port (`psql -h localhost -p 5432 -U app`), and the app reaches the DB **by service name** (no `localhost` in its config).
6. **Reset is clean:** `make reset` recreates the stack and the seeded count from step 3 matches again (volume truly wiped and re-init'd, not stale).
7. **Profiles:** plain `docker compose up -d --wait` starts only core services; `--profile kafka up` additionally starts the gated ones; `docker compose ps` confirms each case.
8. **`down` is safe:** `make down` then `make up` preserves data (row count unchanged); only `make reset` resets it.

Done = `make reset && make up` exits 0 with every service `healthy`, the DB is auto-seeded, a source edit hot-reloads without a rebuild, the app talks to backing services by name, and `make reset` reproducibly returns the stack to a clean seeded state.
