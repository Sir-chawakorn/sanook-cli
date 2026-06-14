---
name: secrets-management
description: Sets up and audits secrets handling in infra and pipelines — moving plaintext secrets to Vault/AWS Secrets Manager/SOPS, OIDC/workload-identity instead of static keys, rotation, and scanning git history for leaks. Triggers when handling credentials in IaC/CI/k8s, removing hardcoded secrets, or planning rotation.
when_to_use: เจอ secret hardcode ใน repo/CI/manifest, จะย้ายไป Vault/Secrets Manager/SOPS, ตั้ง rotation, หรือ key รั่ว
---

## When to Use

Use this skill when ANY of these are true:
- A plaintext credential appears in code, `.env` committed to git, CI config, Terraform `.tf`/`.tfvars`, or a k8s manifest.
- You're migrating static keys to a secrets backend (Vault, AWS/GCP Secrets Manager, SOPS).
- You're wiring CI/CD or workloads to fetch secrets via OIDC / workload identity instead of long-lived keys.
- A key has leaked (pushed to a repo, posted in logs/PR/chat) and needs rotation + history purge.
- Setting up or auditing rotation policy.

Do NOT use for: app-level password hashing, TLS cert issuance (use cert-manager/ACME), or PKI design — different skills.

## Steps

**Phase 0 — Triage: is this a live leak?**
1. If a real secret is already in a remote/pushed commit, a CI log, or a shared channel: treat it as compromised. Jump to Step 13 (rotate FIRST), then come back. Do not "clean up" a pushed secret by deleting the line — the value is already exposed.

**Phase 1 — Scan (find everything before touching anything)**
2. Scan working tree AND full history. Detection-only first:
   - `gitleaks detect --source . --redact --report-format json --report-path gitleaks.json` (scans history via git log).
   - `trufflehog git file://. --only-verified --json` — `--only-verified` actually authenticates candidates against the provider, killing most false positives. Run both; they catch different things.
3. Scan the surfaces gitleaks misses by default:
   - CI config and pipeline vars (`.github/workflows/`, `.gitlab-ci.yml`, CircleCI, Jenkinsfile) — and the CI provider's stored variables (settings UI / API), not just files.
   - k8s manifests: `grep -rEn 'kind:\s*Secret' .` then check for `data:`/`stringData:` with real values; also scan Helm `values.yaml` and ConfigMaps (people stash secrets in ConfigMaps).
   - Terraform state: `terraform show` / `*.tfstate` — state files store provisioned secrets in plaintext even when the `.tf` is clean.
   - Built images: `docker history --no-trunc <img>` and scan layers; secrets baked via `COPY .env` or `ARG` survive in layers.
4. Add a pre-commit gate so new leaks can't land: `gitleaks protect --staged` as a pre-commit hook, and `gitleaks detect` as a required CI job (fail the build on findings).

**Phase 2 — Pick a backend (match to where the secret is consumed)**

| Need | Use |
|---|---|
| Secrets that must live IN git (GitOps, encrypted-at-rest in repo) | SOPS + age (or KMS). Plaintext only in memory at decrypt time. |
| AWS workloads / Lambda / ECS | AWS Secrets Manager (native rotation) or SSM Parameter Store (cheaper, no auto-rotate) |
| GCP workloads | GCP Secret Manager |
| Multi-cloud, dynamic secrets, short-lived DB creds | HashiCorp Vault |
| k8s app consumption | External Secrets Operator (syncs from any backend above) OR Sealed Secrets (encrypt-in-git, no external backend) |

5. Prefer **age** over PGP for SOPS — simpler keys, no GPG agent pain. Config in `.sops.yaml` with a `creation_rules` regex so the right key encrypts the right path. Encrypt only values, not whole file structure: `sops --encrypt --age <pubkey> --encrypted-regex '^(data|stringData|password|token|key)$' secret.yaml`.

**Phase 3 — Kill static keys (this is the real win)**
6. Replace long-lived cloud keys with short-lived identity. Static `AKIA…`/service-account JSON keys are the #1 leak source — remove them, don't just hide them.
   - **CI → AWS:** GitHub OIDC → IAM role via `aws-actions/configure-aws-credentials` with `role-to-assume` + `id-token: write` permission. No `AWS_ACCESS_KEY_ID` secret at all.
   - **CI → GCP:** Workload Identity Federation, no SA JSON key.
   - **k8s pods → AWS:** IRSA (IAM Roles for Service Accounts) or EKS Pod Identity — annotate the ServiceAccount, no key file.
   - **k8s pods → GCP:** GKE Workload Identity.
   - **App → DB:** Vault dynamic secrets (per-request DB creds with a lease) instead of one shared DB password.
7. Scope the resulting role/policy to **least privilege**: one identity per workload, only the exact secret ARNs/paths it reads, only `get`/`describe` (never `*`). Add a condition on the OIDC `sub` claim so only the intended repo/branch/environment can assume the role.

**Phase 4 — k8s wiring**
8. Never apply a hand-written `kind: Secret` with base64 values (base64 is NOT encryption). Use one of:
   - **External Secrets Operator:** `SecretStore`/`ClusterSecretStore` → backend, `ExternalSecret` → defines what to sync. Secret materializes in-cluster only.
   - **Sealed Secrets:** `kubeseal` encrypts to a `SealedSecret` that's safe to commit; controller decrypts in-cluster.
9. Mount via `envFrom`/`valueFrom: secretKeyRef` or projected volume. Avoid passing secrets as `args:` (visible in `ps` and pod spec).

**Phase 5 — Rotation**
10. Set rotation where the backend supports it natively (Secrets Manager rotation Lambda, Vault dynamic leases). For unmanaged secrets, define a documented cadence (e.g. 90d) + an owner, and prefer making them dynamic so rotation is automatic.
11. Ensure consumers re-read on rotation: ESO has a `refreshInterval`; apps caching a secret at boot need a reload signal or restart. A rotated secret that the app never re-fetches = outage.

**Phase 6 — Remediate leaks (only after Step 13 rotation)**
12. Purge history with `git filter-repo --replace-text <patterns>` (preferred over the deprecated `filter-branch`/BFG for new work). Then force-push, and have all collaborators re-clone — rewriting history breaks their local copies. Note: GitHub/GitLab may still serve the old SHA via cached/forked refs, which is exactly why rotation (not purge) is the real fix.

**Phase 6b — When a key is leaked (do this immediately, before everything else)**
13. Rotate/revoke the credential at the provider NOW — this invalidates the exposed value. Order: (a) issue new credential, (b) update the secrets backend, (c) confirm consumers work on the new one, (d) revoke/delete the old one, (e) check provider audit logs for use during the exposure window, (f) THEN purge history (Step 12). Rotation is mandatory; history purge is cosmetic.

## Common Errors

- **base64 ≠ encryption.** A k8s `Secret`'s `data:` is base64-encoded plaintext. Committing it leaks it. Anyone can `base64 -d`.
- **Deleting the line doesn't unleak it.** Once pushed, the value lives in history, forks, clones, and CI caches. The only real remediation is rotation (Step 13).
- **`.gitignore`-ing `.env` after it's committed does nothing** — git already tracks it. You must `git rm --cached` AND purge history AND rotate.
- **Terraform `.tfstate` is plaintext secrets.** Even with a clean `.tf`, state holds resolved values. Use a remote backend with encryption + locking; never commit state; restrict who can `terraform show`.
- **trufflehog without `--only-verified`** drowns you in false positives. With it, you get credentials confirmed live against the provider.
- **gitleaks only scans git by default** — it won't see CI provider stored vars, Vault contents, or running container env. Scan those surfaces separately (Step 3).
- **OIDC role too permissive on the trust policy.** Without a `sub` condition, ANY repo/branch can assume the role. Pin `token.actions.githubusercontent.com:sub` to the exact `repo:org/name:ref:…` or `:environment:prod`.
- **Sealed Secrets are namespace+name scoped** by default. Move the secret to another namespace and decryption fails — don't `kubeseal --scope cluster-wide` just to dodge this without understanding the blast radius.
- **App caches the secret at boot.** Backend rotated, app still uses the old value until restart. Wire a reload or accept a rolling restart on rotation.
- **SOPS re-encrypts the whole file on edit**, churning the diff. Use `--encrypted-regex` so only secret fields are encrypted and structural diffs stay reviewable.
- **Secrets in container build ARGs/layers** persist even if removed in a later step. Use BuildKit `--secret` mounts, never `ARG SECRET=…` or `COPY .env`.

## Verify

Run these; all must come back clean:

1. `gitleaks detect --source . --redact` → exit 0, no findings (working tree + history).
2. `trufflehog git file://. --only-verified` → zero verified secrets.
3. Confirm zero static keys remain: `grep -rEn 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|xox[baprs]-|ghp_[A-Za-z0-9]{36}' .` → no hits in tracked files.
4. CI auth uses OIDC: no `AWS_ACCESS_KEY_ID` / SA-JSON secret exists in the CI provider's stored variables.
5. k8s: `grep -rEn 'kind:\s*Secret' .` returns only `ExternalSecret`/`SealedSecret`, no raw `Secret` with real `data:`.
6. CI has a blocking gitleaks job + pre-commit hook (push a fake `AKIAIOSFODNN7EXAMPLE`-shaped string on a throwaway branch → build must FAIL).
7. For each leaked credential: confirmed rotated at provider AND old value revoked AND provider audit log checked for the exposure window.
8. Rotation: each secret has a backend-native rotation or a documented owner+cadence, and at least one rotation has been test-fired with consumers still healthy.
