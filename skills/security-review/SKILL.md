---
name: security-review
description: Audits changed code for security vulnerabilities — injection (SQL/command/XSS), auth/access-control gaps, secrets in code, unsafe deserialization, SSRF, and insecure dependencies — reporting by severity with concrete remediation. Use when changes touch auth, user input, secrets, file/network IO, or before shipping security-sensitive code.
when_to_use: diff แตะ auth/authz, รับ user input, จัดการ secret/credential, file/network IO, หรือก่อน ship งานที่ sensitive
---

## When to Use

Run this BEFORE shipping any change whose diff touches:
- **Auth / access control** — login, session, JWT, role/permission checks, RLS policies
- **User input** — request params, body, headers, form fields, query strings, file uploads, CLI args
- **Secrets** — API keys, tokens, passwords, connection strings, private keys
- **File or network IO** — path building, `fetch`/`http` to URLs derived from input, deserialization, subprocess spawning
- **New or bumped dependencies** — `package.json`, `requirements.txt`, `go.mod`, lockfiles

Skip only for diffs that are purely cosmetic (formatting, comments, docstrings, log-string wording) with no logic change. When in doubt, run it.

## Steps

1. **Scope the diff.** Run `git diff --merge-base origin/main` (or `git diff main...HEAD`) to get only changed lines. List the changed files and tag each with the categories above (auth / input / secret / IO / deps). Review only tagged hunks plus the functions they call — do not audit the whole repo.

2. **Trace each tainted input to its sink.** For every user-controlled value, follow it through the code. A finding requires an unsanitized path from a **source** (request/arg/file/env) to a dangerous **sink**:
   - SQL string built with concatenation / f-string / template literal → **SQL injection**. Sink: `query(...)`, `execute(...)`, raw ORM `.raw()`.
   - Input passed to `exec`, `system`, `spawn`, `child_process`, `subprocess` with `shell=True`, backticks → **command injection**.
   - Input rendered to HTML without escaping, `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, template autoescape off → **XSS**.
   - Input used in file path (`open`, `readFile`, `sendFile`, `path.join`) without normalization → **path traversal** (`../`).
   - Input used as a URL for server-side `fetch`/`requests`/`http.get` → **SSRF** (check for blocked internal ranges: `169.254.169.254`, `localhost`, `10.`, `192.168.`, `127.`).
   - Input passed to `pickle.loads`, `yaml.load` (non-safe), `eval`, `Function`, Java/`.NET` native deserializers → **unsafe deserialization / RCE**.

3. **Check access control on every new/changed endpoint or handler.** Confirm each one verifies (a) authentication and (b) the caller owns/may access the specific resource (object-level authz — guards against IDOR). Flag any route reachable without a check, or that trusts a client-supplied `user_id`/`role` instead of the session.

4. **Scan for secrets in code.** Grep the diff for live credential shapes: `sk-`, `ghp_`, `glpat-`, `AKIA`, `AIza`, `xoxb-`, `-----BEGIN.*PRIVATE KEY-----`, `Bearer [A-Za-z0-9._-]{20,}`, and `password`/`secret`/`token =` assigned a literal. If found → **report immediately, recommend rotation, and NEVER echo the full value** — show only a masked prefix (e.g. `ghp_****`). Distinguish real secrets from placeholders/env reads (`process.env.X`, `os.environ`, `<YOUR_KEY>`) which are fine.

5. **Check crypto and randomness.** Flag MD5/SHA1 for passwords (require bcrypt/argon2/scrypt), hardcoded IVs/salts, ECB mode, `Math.random()`/`random.random()` for tokens or secrets (require a CSPRNG), and missing TLS verification (`verify=False`, `rejectUnauthorized: false`).

6. **Audit dependencies — including transitive.** Run the ecosystem auditor and read its output:
   - npm/yarn/pnpm: `npm audit --omit=dev` (or `pnpm audit`)
   - Python: `pip-audit` (preferred) or `safety check`
   - Go: `govulncheck ./...`
   - Cross-ecosystem fallback: `osv-scanner --lockfile=<path>`
   Do not stop at direct deps — note CVEs in transitive packages and whether a fixed version exists.

7. **Report by severity.** For each finding emit: **Severity** (Critical / High / Medium / Low), `file:line`, a one-line root cause, a 1–2 line concrete proof-of-concept (the malicious input that triggers it), and the specific fix (parameterized query, `shppath` validation, output encoding, allowlist, etc.). Sort Critical → Low. If nothing is found, say so explicitly and list what was checked.

## Common Errors

- **Generic findings with no location.** "Possible injection somewhere" is useless. Every finding MUST cite `file:line` and show the exact tainted source→sink path. If you can't point to the line, it's not a finding.
- **Stopping at direct dependencies.** Most real CVEs live in transitive deps. Always read the full audit tree, not just `package.json` top-level entries.
- **Flagging env reads / placeholders as leaked secrets.** `process.env.API_KEY`, `os.environ["TOKEN"]`, and `<YOUR_TOKEN_HERE>` are NOT leaks. Only literal credential values are.
- **Echoing a real secret to "prove" it.** Never paste the full value into output, logs, or a PR comment. Mask it. Pasting it re-leaks it.
- **Auditing unchanged code.** Reviewing the whole repo buries real findings in noise and wastes the run. Stay inside the diff plus its immediate call graph.
- **Trusting an existing check exists.** Verify the auth/ownership check is actually on the new path — don't assume middleware covers it.
- **Reporting theoretical issues with no reachable path.** A sink with no untrusted input flowing into it is not exploitable; note it as informational at most, not High.

## Verify

The review is complete and trustworthy when:
- Every changed file in the diff has been tagged and its tagged hunks traced source→sink.
- The dependency auditor actually ran and its exit/output is shown (not "I assume deps are fine").
- Each finding has Severity + `file:line` + PoC input + concrete fix — re-read your output and delete any finding missing one of these.
- No raw secret value appears anywhere in the output.
- Final line states either the count of findings by severity, or an explicit "No issues found" plus the checklist of categories audited (injection, access control, secrets, SSRF, path traversal, deserialization, crypto, deps).
