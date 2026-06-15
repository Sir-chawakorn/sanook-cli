---
name: configure-security-headers-csp
description: Configures HTTP response security headers and a strict, nonce/hash-based Content-Security-Policy — script-src with a per-request nonce or sha256 hash plus 'strict-dynamic' (so you can drop host allowlists and 'unsafe-inline'), object-src 'none', base-uri 'none', frame-ancestors to control framing, a Report-Only rollout via report-to/report-uri before enforcing, plus HSTS with includeSubDomains+preload, X-Content-Type-Options: nosniff, Referrer-Policy, a deny-by-default Permissions-Policy, correct CORS (echo a single allowed origin, never wildcard '*' together with Access-Control-Allow-Credentials), and cookie flags Secure+HttpOnly+SameSite. Eliminates inline-script XSS sinks, clickjacking, MIME-sniffing, mixed content, and credentialed-CORS leaks by policy rather than per-bug patching.
when_to_use: Hardening a web app's HTTP responses — adding or tightening CSP, fixing a console "Refused to execute inline script" after enabling CSP, rolling out HSTS/preload, setting frame-ancestors/Referrer-Policy/Permissions-Policy, or getting CORS and cookie flags right. Distinct from remediate-web-vulnerabilities (finds and fixes a specific bug like a reflected XSS or open redirect; this skill sets the defense-in-depth headers that contain whole bug classes) and setup-cdn-edge-waf (the CDN/WAF edge layer that can inject or override these headers; this skill defines the header values that layer should serve).
---

## When to Use

Reach for this skill when the task is **setting HTTP response headers and CSP as defense-in-depth policy**, not chasing one specific vulnerability:

- "Add a Content-Security-Policy" / "our CSP uses 'unsafe-inline' — make it strict"
- "After turning on CSP the page broke: Refused to execute inline script / Refused to load the stylesheet"
- "Enable HSTS / submit the domain to the preload list"
- "Stop the site from being framed / set frame-ancestors / X-Frame-Options"
- "Set Referrer-Policy and lock down Permissions-Policy (camera, geolocation, FLoC)"
- "Our CORS sends `Access-Control-Allow-Origin: *` with credentials — is that safe?" (no)
- "Cookies missing Secure/HttpOnly/SameSite" / harden the Set-Cookie flags

NOT this skill:
- Finding/fixing a concrete bug — reflected/stored XSS sink, open redirect, SSRF, SQLi — and sanitizing the offending code path → remediate-web-vulnerabilities (this skill is the header *containment* layer that limits the blast radius of such bugs)
- Configuring the CDN/WAF/edge that injects, caches, or overrides these headers, or rate-limits at the edge → setup-cdn-edge-waf (this skill defines the header *values* it should emit)
- TLS certs, cipher suites, OCSP, ACME issuance, the TLS handshake behind HSTS → configure-dns-tls (HSTS only asserts TLS is mandatory; it doesn't provision it)
- Reverse-proxy/load-balancer routing where you might *also* add these headers (nginx/Envoy/Traefik) → configure-reverse-proxy-lb (this skill says *which* headers; that one places them in the proxy)
- The OAuth/OIDC redirect, token, and session-cookie *protocol* → integrate-oauth-oidc / auth-jwt-session (this skill only hardens the cookie *flags* and CORS around them)
- Structured threat enumeration (STRIDE) or a full audit pass → threat-model-stride / security-review
- Active fuzzing/DAST to prove a bypass → fuzz-dynamic-security-test

## Steps

1. **Default to a strict, nonce- or hash-based CSP — host allowlists are obsolete and bypassable.** Allowlist CSPs (`script-src 'self' cdn.example.com`) are trivially defeated via JSONP endpoints, open redirects, or AngularJS on a whitelisted host (Google's own research found ~94% of allowlist CSPs bypassable). The strict pattern:

   ```
   Content-Security-Policy:
     script-src 'nonce-{RANDOM}' 'strict-dynamic' https: 'unsafe-inline';
     object-src 'none';
     base-uri 'none';
     require-trusted-types-for 'script';
     report-uri /csp-report; report-to csp
   ```
   - **`'strict-dynamic'`** lets a nonced/hashed script load further scripts it creates, so you don't enumerate every CDN. When present, browsers that understand it **ignore** `https:` and `'unsafe-inline'` — those are *fallbacks for old browsers only*, not a real relaxation.
   - **`object-src 'none'`** kills Flash/`<object>` injection; **`base-uri 'none'`** stops `<base href>` from rewriting relative script URLs.
   - You usually don't need `default-src` micromanaged once `script-src` is strict; the dangerous directive is script execution.

2. **Generate a fresh 128-bit nonce per response and stamp it on every inline `<script>`.** The nonce must be cryptographically random and **unique per HTTP response** (never reuse, never hardcode) — a static nonce is equivalent to `'unsafe-inline'`.

   | Stack | Generate | Apply |
   |---|---|---|
   | Express | `res.locals.nonce = crypto.randomBytes(16).toString('base64')` | helmet `contentSecurityPolicy` with `(req,res)=>`nonce`; `<script nonce="<%= nonce %>">` |
   | Next.js | nonce in `middleware.ts`, pass via header | Next injects nonce into its own scripts when CSP header has a nonce |
   | Django | `django-csp` `@csp_update` / `{{ request.csp_nonce }}` | `<script nonce="{{ request.csp_nonce }}">` |
   | Rails | `config.content_security_policy_nonce_generator` | `javascript_tag nonce: true` / `nonce: true` in tags |
   | Go/Caddy/nginx | per-request var (sub_filter or middleware) | template the nonce into markup |

   For **static/cached HTML** where you can't inject a per-response nonce, use **`'sha256-...'` hashes** of each inline script's exact bytes instead (compute at build time). Nonces require dynamic rendering; hashes work on a CDN.

3. **Roll out in Report-Only first — never flip enforcing CSP straight to prod.** Ship `Content-Security-Policy-Report-Only` (same policy) alongside any existing enforced policy, collect violations for days/weeks, fix legitimate breakage, then promote to the enforcing header. Wire reporting with the modern `report-to` (a `Reporting-Endpoints` header naming a collector) **and** keep deprecated `report-uri` for older browsers:

   ```
   Reporting-Endpoints: csp="https://example.com/csp-report"
   Content-Security-Policy-Report-Only: script-src 'nonce-...' 'strict-dynamic'; report-to csp; report-uri /csp-report
   ```
   Expect noise from browser extensions injecting inline scripts — triage by `blocked-uri`/`source-file`; don't widen the policy to silence extension reports.

4. **Set `frame-ancestors` to control framing — it supersedes X-Frame-Options.** `frame-ancestors 'none'` (no framing) or `frame-ancestors 'self' https://trusted.example.com` (allow specific embedders). Browsers honor `frame-ancestors` over the legacy `X-Frame-Options: DENY|SAMEORIGIN` when both exist; keep `X-Frame-Options: DENY` only as a fallback for ancient clients. XFO has no allowlist-multiple-origins capability — `frame-ancestors` is the real control.

5. **Pin the rest of the header set — each closes a specific class.**

   | Header | Value (strong default) | Closes |
   |---|---|---|
   | `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | SSL-strip / downgrade; mandates HTTPS for 2y |
   | `X-Content-Type-Options` | `nosniff` | MIME-sniffing a JSON/text response into executable HTML/JS |
   | `Referrer-Policy` | `strict-origin-when-cross-origin` (or `no-referrer`) | leaking full URL + query (tokens) in `Referer` |
   | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | abuse of powerful features; deny-by-default `()` = nobody |
   | `Cross-Origin-Opener-Policy` | `same-origin` | cross-window attacks; required (with COEP) to re-enable `SharedArrayBuffer` |
   | `Cross-Origin-Resource-Policy` | `same-origin` (or `same-site`) | side-channel/Spectre cross-origin reads (data leak) |
   | `X-Frame-Options` | `DENY` (legacy fallback only) | clickjacking on old browsers (else use `frame-ancestors`) |

   HSTS rules: only send over HTTPS; `includeSubDomains` covers every subdomain (verify they're all HTTPS first); **`preload` is a near-irreversible commitment** — once on the browser preload list, removal takes months, so don't add it until you're certain all subdomains are HTTPS-only. Submit at hstspreload.org. `Permissions-Policy` replaces the old `Feature-Policy`; `interest-cohort=()` opts out of FLoC/Topics.

6. **CORS: echo exactly one validated origin — NEVER wildcard with credentials.** The single most common CORS vuln is `Access-Control-Allow-Origin: *` (or reflecting `Origin` blindly) **together with** `Access-Control-Allow-Credentials: true`, which lets any site read authenticated responses.
   - The spec **forbids** `*` + credentials — but reflecting the `Origin` header unchecked is the same hole. **Validate the incoming `Origin` against an allowlist**, and only then echo it back: `Access-Control-Allow-Origin: <that exact origin>` + `Vary: Origin`.
   - Never trust substring/regex matches like `endsWith('.example.com')` (matches `evilexample.com`) or `startsWith('https://example.com')` (matches `https://example.com.evil.com`). Match the full origin against an explicit set.
   - If you don't need credentials, prefer `Access-Control-Allow-Origin: *` **without** credentials — that's safe and simpler. Don't reflect `null` (sandboxed iframes/`file://` send `Origin: null` — allowlisting `null` is exploitable).
   - Set `Vary: Origin` whenever the ACAO value depends on the request, or a cache will serve one origin's allowed-response to another.

7. **Harden cookies: `Secure; HttpOnly; SameSite` — and `__Host-` for session cookies.** Every session/auth cookie:

   ```
   Set-Cookie: __Host-session=...; Secure; HttpOnly; SameSite=Lax; Path=/
   ```
   - **`Secure`** — only sent over HTTPS. **`HttpOnly`** — invisible to `document.cookie`, so an XSS can't exfiltrate it. **`SameSite=Lax`** (default-safe; blocks cross-site POST CSRF) or **`Strict`** for the most sensitive; use `SameSite=None; Secure` only for genuine cross-site cookies (and then you need CSRF defense).
   - The **`__Host-` prefix** forces `Secure`, `Path=/`, and no `Domain` — the browser rejects the cookie if those aren't met, preventing subdomain cookie-fixation. Use it for session cookies. `__Secure-` is the weaker variant (just requires `Secure`).

8. **Set headers once, at the right layer, and don't let it get clobbered.** Prefer a single source of truth: app middleware (helmet / `secure_headers` / `django-csp`) **or** the edge/proxy — not both fighting. If a CDN/WAF (setup-cdn-edge-waf) or reverse proxy (configure-reverse-proxy-lb) also injects headers, confirm which wins (proxies often *append*, producing duplicate/conflicting CSP — the browser then enforces the **intersection**, which can silently break the page). Apply headers to **all** responses including errors, redirects, and API/JSON. Use **helmet** (Express), **`secure_headers`** gem (Rails), **`django-csp` + `SecurityMiddleware`** (Django), or **`securityheaders`** middleware (Go) rather than hand-rolling.

## Common Errors

- **Allowlist CSP with `'unsafe-inline'`.** `script-src 'self' 'unsafe-inline'` provides essentially zero XSS protection — inline injected scripts run. Fix: nonce/hash + `'strict-dynamic'`, drop `'unsafe-inline'` (keep it only as the old-browser fallback that strict-dynamic neutralizes).
- **Reusing or hardcoding the nonce.** A static/cached nonce = `'unsafe-inline'`; the attacker just reads it from the page and reuses it. Fix: fresh CSPRNG nonce per response; for cacheable HTML use hashes instead.
- **Flipping enforcing CSP straight to prod.** You blank-screen real users on day one. Fix: `-Report-Only` first, collect via `report-to`/`report-uri`, fix breakage, then enforce.
- **`'unsafe-eval'` left in to satisfy a library.** Re-opens `eval`/`Function` injection. Fix: move to a CSP-compatible build (no runtime eval); add Trusted Types (`require-trusted-types-for 'script'`) instead of loosening.
- **CSP only on HTML, missing `object-src`/`base-uri`.** `<base>` hijack or `<object>` injection bypasses a script-only policy. Fix: always add `object-src 'none'; base-uri 'none'`.
- **`Access-Control-Allow-Origin: *` (or reflected Origin) with `Allow-Credentials: true`.** Any website reads the victim's authenticated data. Fix: allowlist + echo the single matched origin + `Vary: Origin`; or drop credentials and use `*`.
- **Substring origin matching.** `origin.endsWith('example.com')` allows `notexample.com`/`example.com.evil.com`. Fix: exact full-origin set membership.
- **HSTS `preload` added prematurely / without `includeSubDomains`.** A non-HTTPS subdomain becomes unreachable, and preload removal takes months. Fix: confirm every subdomain is HTTPS-only before `includeSubDomains; preload`; ramp `max-age` up gradually.
- **Setting HSTS over plain HTTP.** Ignored by browsers and a sign of misconfig. Fix: emit HSTS only on HTTPS responses; redirect HTTP→HTTPS first.
- **Cookies without `HttpOnly`/`Secure`/`SameSite`.** XSS steals the session; CSRF rides it; it leaks over HTTP. Fix: `__Host-name=...; Secure; HttpOnly; SameSite=Lax`.
- **Duplicate CSP headers from app + proxy.** Browser enforces the *intersection* of all CSP headers, silently breaking the stricter-than-intended result. Fix: one owner of the header; verify the response has a single CSP.
- **Missing `nosniff`, so an API returns user content as `text/html`.** Browser sniffs and executes it. Fix: `X-Content-Type-Options: nosniff` on every response and correct `Content-Type`.

## Verify

1. **Scan the live headers:** run the response through `securityheaders.com` / Mozilla Observatory, or `curl -sI https://site` — confirm a single `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors` present, with no duplicates.
2. **CSP is strict:** the policy contains a `'nonce-...'` or `'sha256-...'` in `script-src` with `'strict-dynamic'` and **no** standalone `'unsafe-inline'`/`'unsafe-eval'` that a modern browser honors; `object-src 'none'` and `base-uri 'none'` present. Validate with Google's CSP Evaluator.
3. **Nonce is per-response:** fetch the page twice — the nonce value differs each time and matches the inline `<script nonce=...>` tags.
4. **Report-Only worked:** the violation collector received reports and they were triaged before enforcing; the enforced policy doesn't blank the app (load the real pages, check the console for `Refused to...`).
5. **CORS is safe:** `curl -H 'Origin: https://evil.com' -I` to a credentialed endpoint returns **no** `Access-Control-Allow-Origin` for `evil.com` (or omits credentials); an allowlisted origin gets that exact origin echoed plus `Vary: Origin`. No `*`+credentials anywhere.
6. **Cookies hardened:** `Set-Cookie` on the session cookie shows `Secure; HttpOnly; SameSite=...` (and `__Host-` prefix for session); inspect in DevTools → Application → Cookies.
7. **HSTS sane:** `Strict-Transport-Security` only on HTTPS, `max-age` ≥ 1 year, `includeSubDomains` only if every subdomain is HTTPS; `preload` only when committed (verify at hstspreload.org).
8. **Clickjacking blocked:** attempt to frame the site from another origin → blocked by `frame-ancestors`; `X-Content-Type-Options: nosniff` confirmed so a `text/plain` API body isn't sniffed to HTML.

Done = a strict nonce/hash CSP with `'strict-dynamic'` and no honored `'unsafe-inline'`, rolled out via Report-Only then enforced; HSTS (preload only when safe), nosniff, frame-ancestors, Referrer-Policy and a deny-by-default Permissions-Policy all present exactly once; CORS validates origin against an allowlist and never pairs `*`/reflected-origin with credentials; and session cookies carry Secure+HttpOnly+SameSite (`__Host-` prefixed) — all proven by the header scan, CSP evaluator, and CORS/cookie checks above.
