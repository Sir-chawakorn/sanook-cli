---
name: api-design-review
description: Designs and reviews HTTP/REST and RPC API surfaces — resource naming, verbs, status codes, pagination, versioning, idempotency, error envelopes, and backward compatibility. Use when creating a new endpoint or changing an existing API contract.
when_to_use: สร้าง endpoint ใหม่; แก้ request/response schema; เปลี่ยน API contract; ออกแบบ versioning
---

## When to Use

Invoke before writing or merging any change that alters an API contract:

- Adding a new endpoint or RPC method.
- Changing a request or response body (add/remove/rename field, change type, change nullability).
- Changing path, query params, HTTP verb, or status codes of an existing route.
- Designing pagination, filtering, sorting, or a versioning strategy.

Do NOT use for: pure internal refactors with no wire-format change, or UI-only work.

## Steps

1. **Pin the contract surface.** List every consumer-visible element you touch: `METHOD /path`, query params, request body fields, response body fields, status codes, headers. If you can't enumerate it, you can't review it.

2. **Model resources as nouns, actions as verbs.** Path = pluralized noun collection (`/orders`, `/orders/{id}/items`). Never put the action in the path (`/getOrder`, `/createOrder` are wrong). Map intent to verb:
   - `GET` read, no side effects, safe + idempotent.
   - `POST` create / non-idempotent action → returns `201` + `Location` header (or `202` for async).
   - `PUT` full replace, idempotent. `PATCH` partial update.
   - `DELETE` remove, idempotent → `204` (or `200` with body).
   - Genuinely non-CRUD action → POST a sub-resource (`POST /orders/{id}/cancel`), not a verb path.

3. **Pick the correct status code — not a blanket 200.**
   - `201` created (with `Location`), `202` accepted-async, `204` success-no-body.
   - `400` malformed syntax, `401` unauthenticated, `403` authenticated-but-forbidden, `404` not found, `409` conflict (e.g. duplicate, state clash), `422` well-formed but semantically invalid (validation), `429` rate-limited.
   - `5xx` only for server faults — never for client validation failures.

4. **Standardize pagination/filter/sort across the surface.** Pick ONE pagination style and apply it everywhere: cursor-based (`?cursor=&limit=`, opaque cursor, stable for live data — preferred) or offset (`?page=&per_page=`, simpler but drifts on inserts). Return pagination metadata consistently (e.g. `{ "data": [...], "next_cursor": "...", "has_more": true }`). Filtering/sorting via explicit allow-listed params (`?status=open&sort=-created_at`); reject unknown params instead of silently ignoring.

5. **Use a single error envelope for every error response.** Same shape on every 4xx/5xx so clients parse once:
   ```json
   { "error": { "code": "VALIDATION_FAILED", "message": "human readable", "details": [ { "field": "email", "issue": "invalid format" } ] } }
   ```
   `code` = stable machine string (clients branch on this, never on `message`). Don't leak stack traces / internal SQL.

6. **Require idempotency for unsafe writes.** Non-idempotent `POST` that creates resources or moves money/state must accept an `Idempotency-Key` header; server stores key→result and replays the same response on retry. `PUT`/`DELETE` must be naturally idempotent (calling twice = same end state, no error on second `DELETE` of already-gone resource → `204` or `404`, pick one and document it).

7. **Version + run a breaking-change diff.** Diff the new contract against the existing one. Backward-compatible (safe, no version bump): adding an optional field, adding a new endpoint, adding an enum value clients must tolerate, loosening validation. Breaking (needs new version or is forbidden): removing/renaming a field, changing a type, making an optional field required, tightening validation, changing status-code semantics, changing default behavior. Version via URL (`/v2/...`) or header — pick the project's existing convention. If a change is breaking, either make it additive instead, or ship under a new version and keep the old one working.

8. **Validate input at the edge.** Reject unknown/extra fields or define the policy explicitly. Enforce types, ranges, lengths, and required-ness before any business logic runs. Document every field: type, required?, default, constraints, example.

## Common Errors

- **Silent breaking change.** Renaming a response field or tightening validation looks harmless in a diff but breaks every existing client. Always diff against the deployed contract, not just the previous commit.
- **Status code 200 for everything** (including errors, with `{"success": false}` in the body). Clients then can't rely on HTTP semantics, retries/caching/monitoring all misbehave. Use real status codes.
- **`200` for async work.** If processing is deferred, return `202 Accepted` with a status/polling URL — not `200` implying it's done.
- **404 vs 403 leak.** Returning `404` to hide existence is sometimes intentional; returning `403` reveals the resource exists. Decide deliberately and be consistent.
- **POST retried twice creates duplicates** because there's no idempotency key — classic double-charge / double-order bug on flaky networks.
- **Offset pagination on live data** skips or repeats rows when records are inserted/deleted between pages. Prefer cursor for anything mutating.
- **Inconsistent error shapes** across endpoints force clients to write per-endpoint parsing. One envelope, always.
- **`422` vs `400` confusion.** `400` = can't even parse the request; `422` = parsed fine but the values are invalid. Mixing them makes client retry logic wrong.

## Verify

- [ ] Every path is a noun; no verbs in paths.
- [ ] Each operation uses the semantically correct verb and a specific status code (not blanket `200`).
- [ ] Error responses across the whole surface share one envelope with a stable `code` field.
- [ ] All create/state-changing `POST`s accept an idempotency key; `PUT`/`DELETE` are idempotent.
- [ ] Pagination/filter/sort follow one consistent pattern; unknown params are rejected, not ignored.
- [ ] Ran a contract diff vs the deployed version → any breaking change is either reworked to be additive or shipped under a new version with the old one intact.
- [ ] Every request/response field is documented (type, required, default, example) and validated at the edge.
- [ ] No internal details (stack traces, SQL, secrets) leak in any response.

If a contract test / schema snapshot exists, run it and confirm the diff matches the intended (and documented) changes only.
