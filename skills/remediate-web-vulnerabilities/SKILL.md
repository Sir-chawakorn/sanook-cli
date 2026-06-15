---
name: remediate-web-vulnerabilities
description: Fixes specific web vulnerability classes — SQL/command injection, XSS, CSRF, SSRF, IDOR/broken access, insecure deserialization — by applying the canonical hardening (parameterized queries, args-array exec, context-aware output encoding + CSP, SameSite + synchronizer tokens, egress allowlists, per-owner authorization, safe deserialization) and proving each fix with a regression test that replays the exploit.
when_to_use: A specific vuln was found (review, scan, pentest) or an input/output path needs proactive hardening. Distinct from security-review (finds and reports vulns, does not fix), design-authorization-model (authZ architecture, not a single IDOR patch), and defend-llm-prompt-injection (LLM/prompt-specific, not classic web).
---

## When to Use

- "We got a finding for SQL injection / XSS / SSRF — fix it"
- "A pentest flagged IDOR on `GET /orders/:id` — anyone can read any order"
- "Sanitize this user input before it hits the shell / the DB / the page"
- "Harden this URL-fetch endpoint so it can't hit our metadata service"
- "Stop us deserializing untrusted JSON/pickle/YAML into objects"
- Proactively hardening a newly added input or output path before ship

NOT this skill:
- *Finding* and reporting vulns in a diff (no specific one yet) → security-review
- Designing the overall authZ model (roles, policies, tenancy) instead of patching one missing ownership check → design-authorization-model
- Prompt injection / tool-abuse / jailbreaks against an LLM → defend-llm-prompt-injection
- Stress-finding *new* input bugs by mutation/fuzzing → fuzz-dynamic-security-test
- Moving plaintext secrets out of code/IaC and rotating them → secrets-management
- WAF rules / managed rulesets at the edge as a *compensating* control → setup-cdn-edge-waf (a WAF is defense-in-depth, never the fix)

Fix the **class, not the instance**: when you find one concatenated query, grep the codebase and fix every sibling. A WAF rule or input blocklist is a band-aid — remove the unsafe construct.

## Steps

1. **Identify the class, then apply its canonical fix.** Do not invent ad-hoc escaping — each class has one correct construct:

   | Class | Root cause | Canonical fix (do this) | Never (the band-aid) |
   |---|---|---|---|
   | **SQLi** | String-built query | Parameterized query / bound params; ORM with bindings | Escaping quotes, blocklisting `'`/`;`/`--` |
   | **Command injection** | Shell-interpreted string | No shell: exec with **args array**; allowlist binaries/flags | `escapeshellarg`-then-concat into `sh -c` |
   | **XSS** | Untrusted data in HTML | Framework auto-escaping + **context-aware** encoding + CSP; sanitize HTML with DOMPurify | Regex strip of `<script>`, `innerHTML` of user data |
   | **CSRF** | Ambient cookie auth | `SameSite=Lax/Strict` + **synchronizer token** on state-changers | Checking `Referer` only |
   | **SSRF** | User-controlled fetch URL | **Allowlist** dest hosts; block link-local/metadata/private ranges; pin resolved IP | Blocklisting `localhost`/`127.0.0.1` strings |
   | **IDOR / broken access** | authN ≠ authZ | Authorize **every object by owner/tenant**, server-side, on the resolved row | Hiding the ID in the UI; UUIDs as "security" |
   | **Insecure deserialization** | Untrusted bytes → objects | Don't deserialize untrusted data; use data-only formats (JSON) + schema validate | `pickle.loads`, `yaml.load`, Java native, `unserialize()` on input |

2. **SQLi — parameterize, never concatenate.** Pass user data as bound parameters so it is never parsed as SQL. Identifiers (table/column names) can't be parameters — allowlist them against a fixed set.

   ```python
   # BAD: db.execute(f"SELECT * FROM users WHERE email = '{email}'")
   db.execute("SELECT * FROM users WHERE email = %s", (email,))           # psycopg
   # ORM: User.query.filter_by(email=email)   # SQLAlchemy binds automatically
   # Dynamic column: pick from an allowlist, don't interpolate the raw value
   ALLOWED = {"name", "created_at"}
   if sort not in ALLOWED: raise ValueError("bad sort column")            # reject, don't interpolate
   ```

3. **Command injection — drop the shell, pass an args array.** The shell is the vuln; `shell=True` / `sh -c` / `os.system` interpret metacharacters. Pass argv as a list so the OS execs the binary directly with no parsing.

   ```python
   # BAD: subprocess.run(f"convert {path} out.png", shell=True)
   subprocess.run(["convert", path, "out.png"], shell=False, check=True)   # path is one argv element, never re-parsed
   ```
   If a value must be a flag, allowlist it (`if mode not in {"fast","hq"}: reject`). Never build a flag string from user input.

4. **XSS — encode for the output context, add CSP, sanitize HTML only with a vetted lib.** Escaping for HTML body ≠ for an attribute ≠ for JS ≠ for a URL. Let the template engine auto-escape (Jinja `autoescape`, React `{}` text nodes) and don't defeat it (`| safe`, `dangerouslySetInnerHTML`, `v-html`, `innerHTML`). If you must render user HTML, run it through **DOMPurify** first:

   ```js
   el.textContent = userInput;                       // default: text, auto-safe
   el.innerHTML = DOMPurify.sanitize(userHtml);      // ONLY when HTML is required
   // Never build href/src from raw input — reject non-http(s) schemes (blocks javascript:)
   ```
   Add a strict CSP as defense-in-depth: `Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'` — no `unsafe-inline`/`unsafe-eval`. CSP is a second wall, not the fix.

5. **CSRF — `SameSite` cookies + synchronizer token.** Set session cookies `SameSite=Lax` (or `Strict`), `Secure`, `HttpOnly`. For every state-changing request (`POST/PUT/PATCH/DELETE`), require a per-session CSRF token (double-submit cookie or server-stored), compared with a constant-time check. Pure token-auth APIs (`Authorization: Bearer`, no cookies) are not CSRF-prone — don't bolt tokens onto those.

6. **SSRF — allowlist egress, block internal ranges, fetch the pinned IP.** If the destination is user-controlled, default-deny:
   - Allowlist the exact hostnames/domains you intend to reach; reject everything else.
   - Resolve the host, then **reject** `127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, `169.254.0.0/16` (link-local → cloud metadata `169.254.169.254`), `fc00::/7`, and `0.0.0.0`.
   - Resolve once, validate that IP, and connect to **that IP** (pass it explicitly / pin it) to kill DNS-rebinding TOCTOU.
   - Disable redirects, or re-validate the target on each hop. Never follow a redirect to an unvalidated host.

7. **IDOR / broken access — authorize every object by owner, server-side.** Authentication tells you *who*; you still must check *they own this row*. Scope the query or assert ownership on the resolved object — never trust an ID from the request as proof of access.

   ```python
   # BAD: order = Order.get(request.params["id"])   # any id -> anyone's order
   order = Order.get(id=request.params["id"], owner_id=current_user.id)    # scope to caller
   if order is None: raise NotFound()   # 404, not 403 — don't confirm the row exists
   ```
   This is the single-instance patch. If you're (re)designing roles/policies/multi-tenancy, that's design-authorization-model.

8. **Insecure deserialization — never deserialize untrusted bytes.** Object-deserializers (`pickle`, `yaml.load`, Java `ObjectInputStream`, PHP `unserialize`, .NET `BinaryFormatter`) can execute code or instantiate arbitrary types. Accept only data formats and validate against a schema:

   ```python
   # BAD: obj = pickle.loads(body)   /   data = yaml.load(body)
   data = json.loads(body)              # data only, no code execution
   yaml.safe_load(body)                 # if YAML is required
   Payload.model_validate(data)         # pydantic: enforce shape/types
   ```
   If signed objects are unavoidable, verify an HMAC over the bytes *before* deserializing.

9. **Sweep the class and write the regression test.** Grep for every sibling of the fixed pattern (`grep -rn "shell=True"`, `f"SELECT`, `innerHTML =`, `pickle.loads`, `yaml.load(`, `dangerouslySetInnerHTML`). Then write a test that sends the **actual exploit payload** and asserts it no longer triggers (Verify).

## Common Errors

- **Escaping/blocklisting instead of parameterizing.** Quote-escaping and `'`/`;` blocklists are bypassable (unicode, comments, encoding). Use bound parameters — fix the construct.
- **`shell=True` "but I escaped it".** `escapeshellarg`-then-concat still goes through the shell and gets bypassed. Pass an argv array with `shell=False`; no shell, no metacharacters.
- **Sanitizing on input, rendering elsewhere.** Input sanitization can't know the output context. Encode at the point of output (HTML vs attr vs JS vs URL); store data raw.
- **Trusting a custom XSS regex.** Hand-rolled HTML filters miss `onerror=`, `javascript:`, SVG, mutation XSS. Use DOMPurify; never `innerHTML` raw input.
- **CSP with `unsafe-inline`/`unsafe-eval`.** Negates the protection against injected `<script>`. Use nonces/hashes; if you can't, you haven't fixed the XSS — CSP was only the backstop.
- **SSRF fix that blocks strings, not IPs.** Blocking `"localhost"` misses `0`, `0x7f.1`, `[::1]`, decimal IPs, and DNS-rebinding. Resolve and check the **IP** against CIDR ranges, then connect to that resolved IP.
- **Following redirects after SSRF validation.** Validated host 302-redirects to `169.254.169.254`. Disable redirects or re-validate every hop.
- **IDOR "fixed" by switching to UUIDs / hiding the ID.** Obscurity isn't authorization. The fix is the server-side owner/tenant check on the resolved object.
- **Adding authN where authZ is missing.** Logged-in ≠ authorized for *this* object. Scope the lookup to the caller.
- **`yaml.load` left as the "safe" one.** Plain `yaml.load` constructs arbitrary objects. Use `yaml.safe_load`. Likewise `pickle`/`BinaryFormatter`/`unserialize` on input are never safe — switch to JSON + schema.
- **Fixing the reported instance, leaving the class.** The scanner found one; the same pattern lives in ten other files. Grep and fix all, or it regresses next sprint.
- **Calling a WAF rule the fix.** A blocked payload at the edge while the unsafe code remains is unfixed — the next encoding gets through. WAF is defense-in-depth (setup-cdn-edge-waf), not remediation.

## Verify

A fix is proven only when an automated test reproduces the original exploit and asserts it's now inert:

1. **SQLi:** Send `' OR '1'='1` / `'; DROP TABLE--` as the input → response is a normal empty/auth-fail result, no extra rows, no error leaking SQL; query log shows it ran as a bound parameter.
2. **Command injection:** Send `; id`, `$(id)`, `` `id` ``, `| cat /etc/passwd` as the value → no extra process runs, no command output in the response; a sentinel file the payload tries to create does not exist.
3. **XSS:** Submit `<img src=x onerror=alert(1)>` and `javascript:alert(1)` → response renders them as **escaped text** (`<img...`), not live markup; assert the raw `<script>`/`onerror` byte sequence is absent from the HTML. Confirm the `Content-Security-Policy` header is present and free of `unsafe-inline`.
4. **CSRF:** Replay a state-changing `POST` with a valid session cookie but **no/forged** CSRF token → rejected (`403`); the same request with a valid token → succeeds.
5. **SSRF:** Request each blocked target — `http://169.254.169.254/`, `http://127.0.0.1`, `http://[::1]`, a decimal-IP form, and a host that 30x-redirects to `169.254.169.254` → all rejected before any socket to an internal range opens; only an explicitly allowlisted host returns `200`. Assert the connection to the internal range was never opened.
6. **IDOR:** As user A, request user B's object ID → `404` (not the row, not a `403` that confirms existence); as the owner → `200`. Run it for every object-scoped route you touched.
7. **Deserialization:** Feed a malicious pickle/`!!python/object` YAML/gadget payload → rejected at schema validation, no object instantiated, no code executed (sentinel side-effect absent).
8. **Class sweep:** The grep for the unsafe construct returns zero remaining hits in app code (excluding the test fixtures that hold the payloads).

Done = the exploit-replay test for the fixed class **failed before** the change and **passes after**, the canonical construct (not a blocklist/WAF rule) is in place, the class-wide grep is clean, and no Critical regression remains.
