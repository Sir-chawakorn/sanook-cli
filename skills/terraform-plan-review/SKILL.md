---
name: terraform-plan-review
description: Reviews Terraform/OpenTofu plans and modules with a safety-first, diagnose-first lens — blast radius of destroys/replaces, identity churn, drift, state risks, secret exposure — before any apply. Triggers when reviewing a terraform plan diff, authoring modules, or gating an apply in CI.
when_to_use: ก่อน terraform/tofu apply, รีวิว plan diff, เขียน/ตรวจ module, มี resource destroy/replace น่ากลัว, สงสัย drift
---

## When to Use

Use this skill BEFORE any `terraform apply` / `tofu apply`, and whenever you:
- Review a plan diff (the `~`/`-`/`-/+` lines, or `terraform show -json` output).
- Author or refactor a module (variables, `for_each`/`count`, outputs).
- Gate an apply in CI/CD (PR check, plan-as-artifact, OPA/Sentinel policy).

Core stance: **diagnose first, never auto-approve.** A plan that only adds (`+`) is low-risk; one with `-` (destroy) or `-/+` (replace) on stateful resources can be irreversible data loss. Your job is to surface blast radius and force a conscious go/no-go — not to rubber-stamp green output. Treat the plan as the source of truth, ground every claim in provider docs, and never invent resource behavior.

The commands below apply identically to OpenTofu — swap `terraform` for `tofu`.

## Steps

1. **Generate a deterministic, machine-readable plan.** Never review live console scroll. Run:
   ```
   terraform plan -out=tfplan.bin -lock-timeout=120s
   terraform show -json tfplan.bin > tfplan.json
   ```
   Reviewing a saved plan file and then `apply tfplan.bin` guarantees what you reviewed is exactly what runs (no TOCTOU drift between plan and apply).

2. **Bucket every change by action.** Parse `tfplan.json` → `.resource_changes[].change.actions`:
   - `["create"]` → low risk.
   - `["update"]` → in-place, usually safe; check WHICH attributes (step 4).
   - `["delete","create"]` (shown as `-/+`) → **replace** = destroy then recreate. High risk.
   - `["create","delete"]` → replace with `create_before_destroy` (less downtime, but check capacity/quota).
   - `["delete"]` → **destroy**. Highest risk. Flag every single one.
   Quick triage:
   ```
   jq -r '.resource_changes[] | select(.change.actions != ["no-op"]) | "\(.change.actions | join(",")) \(.address)"' tfplan.json | sort | uniq -c
   ```

3. **Flag blast radius — these block go by default:**
   - **Any destroy/replace of stateful resources**: databases, disks/volumes, buckets/blob storage, stateful sets, persistent caches. Replacing these = data loss unless a snapshot/backup exists. Demand a backup or `prevent_destroy` before approving.
   - **Forced replace from immutable attribute changes** — look at `change.replace_paths` in the JSON; it names the exact attribute forcing recreation (e.g. changing an availability zone, name, or engine version). Confirm the change is intended, not an accidental edit.
   - **`count` → `for_each` migrations or reordered `count` lists** → index churn: removing element 0 of a `count` list shifts every later index, destroying/recreating unrelated resources. `for_each` with stable string keys avoids this. If you see a wide swath of replaces from one small edit, this is almost always the cause.
   - **`-target` used to scope the apply** → silently skips dependency graph; flag as partial apply that can leave state inconsistent. Allowed only as a deliberate break-glass, noted in the PR.
   - **`null_resource`/`terraform_data` with `triggers` churning** → re-runs provisioners; check the provisioner isn't destructive.

4. **Walk the failure-mode table (diagnose, don't assume):**

   | Failure mode | What to grep / inspect | Why it bites |
   |---|---|---|
   | **Identity / IAM churn** | replaces or deletes on roles, policies, bindings, service accounts, key pairs | Recreating identity revokes live access → cascading outages; new keys break dependents mid-apply |
   | **Secret exposure** | `sensitive` values surfacing in outputs, `local_file`/`template_file` writing secrets to disk, secrets in plain `variable` defaults or committed `.tfvars`, plan JSON containing raw credentials | Plaintext secrets land in state, logs, CI artifacts, or git — state is NOT encrypted by default |
   | **Blast radius** | count of destroy+replace vs intended scope; one-line edit → many resources changing | A typo in a shared `local`/module input can ripple across an entire environment |
   | **CI drift** | `terraform plan -detailed-exitcode` returns 2 (changes) on a "no-change" branch; resources changed outside Terraform | State no longer matches reality; next apply may revert manual fixes or fail mid-run |
   | **State corruption / lock** | missing or stale state lock, two pipelines applying same state, local state instead of remote backend, no versioning on the state bucket | Concurrent applies corrupt state; lost state = orphaned real infra you can no longer manage |

5. **Inspect module structure & state hygiene (when authoring or auditing):**
   - Variables typed and validated (`type`, `validation` blocks); no untyped `any` on security-relevant inputs.
   - Outputs don't leak secrets; mark with `sensitive = true` where needed (note: this only redacts CLI output, NOT state).
   - **Remote state with locking + encryption + versioning** is mandatory for shared environments — local `terraform.tfstate` in a team repo is a finding. Confirm `backend` config locks (DynamoDB table / native lock / blob lease) and the state store has versioning so you can roll back.
   - **Workspace / environment isolation**: prod and non-prod must not share one state file or one backend key. Verify per-env state separation.
   - Pin provider and module versions (`required_providers` with `~>` constraints, module `version`/ref). Unpinned `latest` = non-reproducible plans.

6. **Ground every resource-behavior claim in provider docs (anti-hallucination).** Before asserting "this attribute forces replacement" or "this is safe in-place," confirm against the actual provider documentation for that resource/version. Do not infer behavior from the resource name. If you cannot verify, say so and mark the finding as uncertain rather than guessing.

7. **Run static security/policy scans and read the findings:**
   ```
   tfsec . --soft-fail        # or: trivy config .
   checkov -d . --compact
   ```
   Triage real issues (public exposure, unencrypted storage, permissive IAM, open security groups) vs. accepted/false-positive rules. Don't dump raw scanner output — summarize what actually matters for this change.

8. **Emit a go / no-go verdict.** Structure: counts by action → list every destroy/replace with its `replace_paths` cause → secret/IAM findings → scan findings → explicit **GO** or **NO-GO** with the single most dangerous line called out, and the exact remediation (snapshot first / add `prevent_destroy` / switch to `for_each` / pull secret into a vault). Never end with just "looks fine."

## Common Errors

- **Reviewing live `plan` output, then running a fresh `apply`.** State or remote data can change in between → you apply something you never reviewed. Always `-out` a plan file and apply that exact file.
- **Trusting green/“no changes” without `-detailed-exitcode`.** Plain `plan` exits 0 even when there are changes. Use `-detailed-exitcode`: `0` = no changes, `1` = error, `2` = changes present. CI gates must check for `2`.
- **Missing replaces because you only read `+`/`-` summary lines.** A `-/+` (replace) on a database reads almost like a normal update at a glance but destroys data. Parse `actions` from JSON, don't eyeball the colored summary.
- **Assuming `sensitive = true` protects the secret.** It only redacts CLI/log output. The value is still **stored in plaintext in state** and may appear in plan JSON artifacts. The fix is to not put the secret in Terraform-managed values at all — reference a secrets manager.
- **Editing a `count`-based list and triggering mass recreation.** Inserting/removing a middle element shifts all later indices → cascade of destroy/replace. Migrate to `for_each` with stable keys; expect the migration plan itself to churn (use `moved {}` blocks to avoid destroy on refactor).
- **Approving a `-target` apply as if it were a full plan.** `-target` bypasses parts of the dependency graph and can leave state half-applied. It is break-glass only.
- **Refactoring modules/renaming resources without `moved {}` blocks.** Renaming an address makes Terraform plan destroy-old + create-new instead of a no-op rename. Add `moved {}` (or `import`/`state mv`) so refactors stay free of real destroys.
- **Local state in a shared repo / no lock.** Two applies race and corrupt state. Require a remote backend with locking, versioning, and encryption before approving.

## Verify

A review is complete only when ALL of these hold:
- [ ] Action buckets counted from `tfplan.json` (create / update / replace / destroy) — not eyeballed from console color.
- [ ] **Every** destroy and replace is listed with its `replace_paths` root cause and an explicit data-loss assessment.
- [ ] Stateful destroys/replaces have a verified backup/snapshot OR `prevent_destroy`, OR the verdict is NO-GO.
- [ ] Plan JSON, outputs, and `.tfvars` checked for plaintext secrets; remote state confirmed encrypted + versioned + locked.
- [ ] `terraform plan -detailed-exitcode` interpreted correctly in any CI gate (treats exit `2` as "changes present").
- [ ] `tfsec`/`checkov` (or equivalent) run; findings triaged, not ignored.
- [ ] Every resource-behavior claim grounded in provider docs; uncertain points flagged, not asserted.
- [ ] Output ends with an explicit **GO / NO-GO** plus the top risk line and its remediation.
- [ ] The reviewed artifact is the same plan file that gets applied (`apply tfplan.bin`), so there's no gap between review and execution.
