---
name: send-transactional-email
description: Ships reliable transactional email (password resets, receipts, verification, alerts) where the hard part is deliverability, not the API call — authenticate the From domain with SPF/DKIM/DMARC alignment, send through a provider (SES/Postmark/SendGrid/Resend/Mailgun) instead of a cold self-hosted MTA, isolate transactional from marketing streams, build inlined-CSS multipart emails, send idempotently via a job runner, and process bounce/complaint webhooks into a suppression list so mail actually lands in the inbox.
when_to_use: Sending or fixing delivery of transactional email — auth/verification/reset/receipt mail landing in spam, domain authentication (SPF/DKIM/DMARC), bounce/complaint handling, suppression lists, or rendering. Distinct from implement-push-notifications (the mobile/web PUSH channel, a different transport entirely) and message-queue-jobs (the async job system that ENQUEUES the send and owns retry/DLQ — this skill owns the email-specific deliverability, content, and feedback loop).
---

## When to Use

Reach for this skill when the work is **getting a transactional email into the inbox and reacting to what bounces** — domain auth, provider routing, content, and the feedback loop:

- "Password-reset / verification emails are landing in spam (or vanishing) — fix deliverability"
- "Set up SPF / DKIM / DMARC so our From domain authenticates and aligns"
- "Pick and wire a provider (SES, Postmark, SendGrid, Resend, Mailgun) for receipts/alerts"
- "Our marketing blasts are tanking password-reset delivery — separate the streams"
- "Process bounce + complaint webhooks and stop re-sending to dead addresses"
- "Build the email so it renders right in Outlook/Gmail/dark mode with a plain-text fallback"
- "A retry double-sent the receipt / verification email — make sends idempotent"

NOT this skill:
- The async job/queue that **enqueues** the send, owns retry-with-backoff, DLQ, poison-message handling → message-queue-jobs (this skill is what runs *inside* that job)
- The idempotency-key store/dedup primitive that makes the enqueue+send exactly-once → idempotency-keys
- Mobile/web **PUSH** notifications (APNs/FCM/Web Push) — a different transport, not email → implement-push-notifications
- The raw DNS record mechanics (TTL, zone editing, how a TXT/CNAME is published) → configure-dns-tls (this skill tells you *which* records; that skill publishes them)
- Tracking-pixel/open-tracking consent, unsubscribe-data handling, PII retention/erasure → map-privacy-data-gdpr
- Throttling how many emails one user can trigger → rate-limiting
- Marketing campaigns, newsletters, drip sequences, segmentation → (out of scope — a different sending stream entirely; see step 3)

This skill owns **domain authentication, provider/stream choice, email content, idempotent sending, and feedback processing**. It hands the actual job-running to message-queue-jobs.

## Steps

1. **Authenticate the sending domain — this is the gate, not optional.** Gmail/Yahoo require SPF + DKIM + DMARC on bulk and increasingly on all mail; without alignment you go to spam or get rejected. Publish all three on the From domain (records owned by configure-dns-tls; *values* below). Use a dedicated subdomain like `mail.example.com` / `txn.example.com` so reputation is scoped.

   | Record | Where | Value (shape) | Purpose |
   |---|---|---|---|
   | **SPF** | `TXT` at sending domain | `v=spf1 include:amazonses.com ~all` (one TXT, ≤10 DNS lookups, `~all` not `-all` until verified) | authorizes the provider's IPs in `Return-Path` |
   | **DKIM** | provider-given `CNAME`s (SES, Resend) or `TXT` (`<sel>._domainkey`) | provider publishes the public key; mail is signed `d=example.com` | cryptographic signature, survives forwarding |
   | **DMARC** | `TXT` at `_dmarc.example.com` | `v=DMARC1; p=none; rua=mailto:dmarc@example.com; adkim=s; aspf=s` | tells receivers what to do on auth fail + reports |

   **Alignment is the part people miss:** DMARC passes only if SPF *or* DKIM passes **and** its domain matches the **visible `From:`** domain. `Return-Path: bounces@provider.com` aligning SPF to the provider does **not** align to your From — so DKIM `d=` must equal your From domain. Set a **custom Return-Path / MAIL FROM** subdomain (`bounce.example.com`) at the provider for SPF alignment too. Roll DMARC `p=none` → monitor `rua` reports for 1–4 weeks → `p=quarantine` → `p=reject`. Never start at `reject`; you'll blackhole your own mail.

2. **Send through a reputable provider — do NOT run your own SMTP MTA on cold IPs.** A fresh cloud IP has zero reputation and is often already on a blocklist; running Postfix yourself means you own PTR, warmup, FBL enrollment, and blocklist fights. Use a provider:

   | Provider | Best for | Notes |
   |---|---|---|
   | **Postmark** | pure transactional, fastest inbox | hard-blocks marketing on transactional streams; great deliverability |
   | **Amazon SES** | volume, cost | cheapest; you do more setup; sandbox until prod access granted |
   | **Resend** | DX-first, modern stacks | React-email native; simple DKIM CNAMEs |
   | **SendGrid / Mailgun** | scale, both streams | bigger surface, more knobs |

   If you self-host anyway (rare): set **PTR / reverse DNS** so the IP resolves back to your HELO hostname (no PTR ≈ instant spam), enroll in every provider's **FBL**, and warm the IP. For 99% of cases, a provider is the answer.

3. **Separate TRANSACTIONAL from MARKETING — different subdomains, IPs, and streams.** A marketing complaint must **never** be able to poison password-reset delivery. Use `txn.example.com` (or a dedicated transactional stream/IP pool) for resets/receipts/verification, and `news.example.com` (separate IP/stream) for campaigns. Postmark enforces this with separate Streams; SES uses separate **configuration sets** + dedicated IP pools. Mixing them means one bad newsletter tanks your ability to log users in.

4. **Dedicated vs shared IP, and warm up before volume.** Shared IP (provider's pool) is fine and *better* at low/spiky volume — you inherit the pool's warm reputation. Move to a **dedicated IP** only above ~100k/month steady, then **warm it**: ramp send volume gradually so receivers learn the IP is legit.

   | Day | Max sends/day (rough) |
   |---|---|
   | 1–2 | 50 → 100 |
   | 3–5 | 500 → 1,000 |
   | 6–10 | 5,000 → 20,000 |
   | 11–20 | double daily toward target |

   Send your **best, most-engaged traffic first** during warmup; complaints early on a cold dedicated IP are very expensive.

5. **Build the email so it actually renders — inline CSS, multipart, dark-mode, accessible.** Email clients (esp. Outlook/Word engine, Gmail) strip `<style>`, ignore flexbox/grid, and need table layout. Use **MJML** (compiles to bulletproof tables) or a templating tool with a **CSS inliner** (`juice`, premailer) — never raw `<div>` flexbox.
   - **Always send `multipart/alternative`** with both `text/plain` AND `text/html`. A missing/empty plain-text part is a strong spam signal and breaks watches/screen readers.
   - **Inline every style** (`style="…"` on elements); media queries in `<head>` for mobile/dark-mode are progressive enhancement only.
   - **Dark mode:** set `<meta name="color-scheme" content="light dark">` and `supported-color-schemes`; don't rely on transparent PNG logos (add a background).
   - **Accessible:** real `alt` on images (many clients block images by default — the email must make sense with images off), sufficient contrast, semantic headings, descriptive link text (not "click here").
   - Put the critical action (reset link, code) in **text**, not baked into an image.

6. **Set From / Reply-To / Return-Path correctly.** `From:` = a real, branded, *authenticated* address on your sending domain (`noreply@txn.example.com` is fine but a monitored `Reply-To` is friendlier). `Reply-To:` → where humans actually reach you (`support@example.com`). **`Return-Path` / envelope MAIL FROM** → the provider's/your bounce-handling address on an SPF-aligned subdomain; this is where bounces go and what SPF checks — **never** your visible From. Mismatched/spoofed From domains fail DMARC.

7. **Make every send idempotent — a retry must not double-send.** The job runner (message-queue-jobs) will retry on transient failure; without a guard, the user gets two receipts. Compute a stable **idempotency key** per logical email (e.g. `sha256(user_id + email_type + event_id)`) and record it transactionally before/with the send. Most providers also accept a request-level idempotency/dedup token — pass it. (The dedup-store primitive is idempotency-keys; this skill defines *what makes an email send unique*.)

   ```python
   key = sha256(f"{user_id}:password_reset:{reset_request_id}").hexdigest()
   if not claim_idempotency_key(key):      # atomic INSERT … ON CONFLICT DO NOTHING
       return                              # already sent — silently no-op
   provider.send(msg, idempotency_key=key) # provider-level dedup too
   ```
   Enqueue the send as a job rather than sending inline in the request path, so a slow provider or 5xx doesn't fail the user's HTTP request — see message-queue-jobs.

8. **Process bounces + complaints and maintain a suppression list — never re-send to dead/complained addresses.** Wire the provider's **webhooks** (SES→SNS, Postmark/SendGrid/Mailgun event webhooks) and feed a `suppression` table that the send path checks *before* every send. Verify webhook signatures (these are untrusted inbound — see ingest-webhook-secure).

   | Event | Meaning | Action |
   |---|---|---|
   | **Hard bounce** | address doesn't exist | **suppress permanently**, never retry |
   | **Soft bounce** | mailbox full / temporary | retry a few times, then suppress if persistent |
   | **Complaint (FBL)** | user hit "spam" | **suppress permanently**; investigate — this is reputation poison |
   | **Spam / blocked** | content/IP blocked | pause stream, inspect content/reputation |

   A single complaint costs far more than a lost email. Re-sending to a hard bounce or complainer destroys sender reputation for *everyone* on the stream.

9. **Honor unsubscribe — `List-Unsubscribe` + One-Click — even on transactional.** Gmail/Yahoo bulk rules require a `List-Unsubscribe` header with **one-click** support; even for transactional mail it's good practice (and required if there's any promotional content). Pure system mail (password reset) can be exempt, but adding the header never hurts.

   ```
   List-Unsubscribe: <https://example.com/u/abc123>, <mailto:unsub@example.com>
   List-Unsubscribe-Post: List-Unsubscribe=One-Click
   ```
   A POST to the URL must unsubscribe with no further interaction. (Consent/unsubscribe *data* handling → map-privacy-data-gdpr.)

10. **Monitor reputation and stay under the thresholds.** Enroll the domain in **Google Postmaster Tools** and watch your provider's dashboards. Hard limits that get you throttled/blocked: **complaint rate < 0.1%** (Gmail's red line is 0.3%, but treat 0.1% as the ceiling), bounce rate low single digits, no blocklist hits. Set alerting on a spike (observability-instrument). A climbing complaint rate is an early warning before a hard block.

11. **Test in a sandbox — NEVER send to real addresses from staging.** Catch a misconfigured loop emailing 50k real users *before* prod.
    - **Local/CI:** capture all SMTP into **Mailpit** or **MailHog** (a fake inbox); assert subject, both MIME parts, and rendered HTML in tests.
    - **Provider sandbox:** **SES sandbox** only delivers to verified addresses; Postmark has a test API token that accepts-but-doesn't-deliver.
    - **Inbox placement / seed list:** before a big change, send to a seed list (GlockApps/provider tools) to see Gmail/Outlook/Yahoo inbox-vs-spam placement.
    - Gate the real provider behind an env flag so staging can only hit Mailpit/sandbox — never live SMTP.

12. **Mind tracking privacy and don't trust open rates.** Open tracking = a 1×1 pixel; **Apple Mail Privacy Protection (MPP)** pre-fetches it, **inflating opens to near-100%** and making opens worthless for engagement. Tracking pixels are personal-data processing under GDPR — needs a lawful basis and arguably consent (→ map-privacy-data-gdpr). For transactional mail, prefer **no open tracking**; if you wrap links for click tracking, keep redirects fast and on your own domain so they don't trip spam filters or break the link on failure.

## Verify

1. **Auth passes and aligns:** send to `check-auth@verifier.port25.com` or mail-tester.com — SPF `pass`, DKIM `pass` with `d=` your From domain, DMARC `pass` with **alignment**. `dig TXT _dmarc.example.com` shows the policy; `dig TXT <sel>._domainkey.example.com` resolves.
2. **DMARC ramped safely:** `rua` aggregate reports show your legit mail passing for 1–4 weeks at `p=none` *before* you move to `quarantine`/`reject`.
3. **Streams isolated:** a forced complaint/bounce on the marketing stream does **not** appear in or degrade the transactional stream's reputation/dashboards.
4. **Renders everywhere:** the HTML shows correctly in Gmail, Outlook (Word engine), Apple Mail, and dark mode; with images blocked the email is still actionable (alt text, text link); a `text/plain` part exists and is non-empty.
5. **Idempotent:** trigger the same logical email twice (or force a job retry) → exactly **one** message is delivered; the second is a no-op.
6. **Feedback loop works:** send to a provider seed/simulator bounce + complaint address → webhook fires, the address lands in the **suppression** table, and a subsequent send to it is **skipped before** hitting the provider.
7. **Unsubscribe one-click:** a POST to the `List-Unsubscribe` URL unsubscribes with no extra step; Gmail shows the unsubscribe affordance.
8. **No real mail from non-prod:** staging/CI sends are captured by Mailpit/MailHog/sandbox and cannot reach a real inbox; a deliberate "send to a real address" from staging is blocked.
9. **Reputation green:** Google Postmaster shows domain reputation High/Medium, complaint rate **< 0.1%**, no blocklist entries.

Done = the From domain passes SPF/DKIM/DMARC with alignment (DMARC ramped p=none→quarantine→reject on real report data), transactional mail goes through a provider on a stream isolated from marketing, emails render with inlined CSS + a plain-text part, sends are idempotent under retry, bounces/complaints flow into a suppression list that the send path honors, and no staging environment can email a real user.
