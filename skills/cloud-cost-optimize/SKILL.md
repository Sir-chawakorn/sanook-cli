---
name: cloud-cost-optimize
description: Performs FinOps cost optimization on AWS/GCP/Azure — right-sizing instances, spotting idle/orphaned resources, Savings Plans/Reserved/committed-use analysis, storage tiering, and cost anomaly investigation. Triggers when a cloud bill spikes, doing a cost review, or right-sizing infrastructure.
when_to_use: bill cloud พุ่ง, รีวิว cost/FinOps, right-size instance, หา resource ที่ idle/orphan, วิเคราะห์ cost anomaly
---

## When to Use

- Cloud bill jumped vs last month/period and you need to find *what* and *why* before paying it.
- Scheduled FinOps / cost review of an account, project, or subscription.
- Right-sizing a fleet (EC2 / Compute Engine / VM Scale Sets, RDS/Cloud SQL, EKS/GKE/AKS nodes).
- Hunting idle or orphaned resources draining money with zero traffic.
- Deciding commitment strategy: Savings Plans / Reserved Instances / Committed-Use Discounts vs Spot/Preemptible.

Skip if: you only need a one-off price quote for a single SKU (use the pricing calculator), or the spike is already explained by a known launch/migration.

## Steps

Detect the provider first — never assume. Check for `~/.aws/credentials` / `AWS_PROFILE`, `gcloud config list`, or `az account show`. Always pin scope (`--region`, `--project`, subscription) and a date window. Always start **read-only**; never mutate in the analysis phase.

### 1. Pull the cost breakdown by service + tag (find the biggest lever)
Don't eyeball the console — pull structured data grouped by service AND a cost-allocation dimension, so you know where the money actually is.
- **AWS:** `aws ce get-cost-and-usage --time-period Start=<YYYY-MM-01>,End=<YYYY-MM-01> --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE` then re-run grouped by `Type=TAG,Key=<env|team|app>` and by `Type=DIMENSION,Key=USAGE_TYPE` for the top service. Compare two consecutive months to isolate the delta.
- **GCP:** query the **BigQuery billing export** (`SELECT service.description, sku.description, SUM(cost) ... GROUP BY ... ORDER BY 3 DESC`). The console export lags and rounds; BQ is the source of truth. If no export configured, that's finding #1.
- **Azure:** `az costmanagement query --type ActualCost --timeframe MonthToDate --dataset-grouping name=ServiceName type=Dimension`.
- Output: top 5 services by spend + their MoM delta. Everything below focuses effort on these, not on the long tail.

### 2. Find idle + orphaned resources (fast money, low risk)
These cost money for nothing. Hit each class explicitly:
- **Unattached block storage:** AWS `aws ec2 describe-volumes --filters Name=status,Values=available` (status `available` = detached, still billed). GCP unattached PDs (`gcloud compute disks list` + cross-check users field empty). Azure `az disk list --query "[?diskState=='Unattached']"`.
- **Unassociated static IPs:** AWS EIPs not attached to a running instance are billed hourly — `aws ec2 describe-addresses --query "Addresses[?AssociationId==null]"`. Same for idle GCP static external IPs / Azure unassociated Public IPs.
- **Idle load balancers:** ELB/ALB/NLB with zero `RequestCount`/`ActiveFlowCount` over 14d in CloudWatch. An ALB with no targets or no traffic is pure waste.
- **Stale snapshots & old AMIs/images:** snapshots older than your retention policy, AMIs no launch-templated anywhere. These grow silently.
- **Over-provisioned managed clusters:** EKS/GKE/AKS node groups with low pod density — check `kubectl top nodes` and allocatable vs requests. Empty/cordoned nodes that never scaled down.
- **Forgotten dev/staging:** non-prod compute running 24/7. Tag-filter `env!=prod` and check for instances with no business reason to run nights/weekends → schedule stop or use auto-shutdown.
- **NAT Gateway / cross-AZ data:** often a hidden top-3 line item. Flag for step 5.

### 3. Right-size compute on REAL utilization (not nameplate)
Never resize on instance type alone — pull 14–30 days of actual metrics.
- **AWS:** start with **Compute Optimizer** (`aws compute-optimizer get-ec2-instance-recommendations`) — it already crunched p99 CPU/mem/network and gives a target type + projected savings. Validate against CloudWatch `CPUUtilization` p99 and **memory** (CloudWatch agent required — if mem isn't published, say so; CPU-only sizing is unsafe for memory-bound apps). Rule of thumb: sustained p99 CPU < 40% and p99 mem < 50% → downsize one step.
- **GCP:** use **Recommender** (`gcloud recommender recommendations list --recommender=google.compute.instance.MachineTypeRecommender`).
- **Azure:** **Advisor** right-size recommendations (`az advisor recommendation list --category Cost`).
- **Databases:** RDS/Cloud SQL/Azure SQL are frequently oversized — check CPU, connections, and IOPS p99. Move gp2→gp3 on RDS (cheaper, decoupled IOPS) as a near-zero-risk win.
- Prefer the same-family smaller size or a newer generation (e.g. m5→m6i/m7g Graviton) before exotic types — Graviton/ARM is often ~20% cheaper at equal perf if the workload is ARM-compatible.

### 4. Commitment analysis (Savings Plans / RI / CUD vs Spot)
Only after right-sizing — committing to oversized capacity locks in waste.
- Pull current commitment **coverage** and **utilization**: AWS `aws ce get-savings-plans-utilization` + `get-savings-plans-coverage` (and `get-reservation-coverage` for RDS/ElastiCache/Redshift/OpenSearch which use RIs, not SPs). Coverage low + steady baseline = buy more; utilization < 95% = you over-committed.
- Use the provider's **purchase recommendations** as the starting number: AWS `aws ce get-savings-plans-purchase-recommendation --term-in-years ONE_YEAR --payment-option NO_UPFRONT --lookback-period-in-days THIRTY_DAYS`. Default to **Compute Savings Plans** (flexible across family/region/Fargate/Lambda) over EC2 Instance SPs unless the fleet is truly static. 1yr no-upfront is the safe default; 3yr only for proven-stable baseline.
- **GCP:** CUDs — prefer **flexible/spend-based** CUDs over resource-based for changing fleets.
- **Spot/Preemptible:** for stateless, fault-tolerant, batch, or interruptible workloads → 60–90% off. Quantify what fraction of compute is spot-eligible; that's the cheapest capacity tier and should be exhausted before buying commitments for it.
- Output: recommended commitment $ + projected monthly savings + break-even, and explicitly the baseline (committed) vs burst (on-demand) vs interruptible (spot) split.

### 5. Storage tiering + data-transfer / egress
- **Object storage:** enable lifecycle/Intelligent-Tiering. S3 → Intelligent-Tiering or lifecycle to IA/Glacier by access age; GCS → Autoclass or Nearline/Coldline/Archive; Azure → Blob lifecycle Hot→Cool→Cold→Archive. Check for **no lifecycle policy at all** on large buckets — common silent leak.
- **Incomplete multipart uploads / old versions:** S3 hides cost in incomplete MPU and noncurrent versions — add a lifecycle rule to abort/expire them.
- **Egress / data transfer:** usually the most opaque line item. Cross-AZ chatter, NAT Gateway processing, inter-region replication, and internet egress. Mitigations: VPC/Gateway/PrivateLink endpoints to avoid NAT for AWS-service traffic, co-locate chatty services in one AZ, CloudFront/CDN in front of egress-heavy origins, and check that internal traffic isn't routing through public IPs.
- **Logs/metrics retention:** CloudWatch Logs / Cloud Logging / Log Analytics with infinite retention silently balloon — set retention and route cold logs to object storage.

### 6. Tagging, budgets, and anomaly alerts (prevent the next spike)
- **Tag coverage:** quantify % of spend that is **untagged** (allocation gap). Untagged spend = can't attribute = can't optimize. Recommend enforcing required tags (`env`, `owner`, `cost-center`) via SCP/Org Policy/Azure Policy.
- **Budgets:** AWS Budgets / GCP Budget alerts / Azure Cost Management budgets with alert thresholds at 50/80/100% to the owning team.
- **Anomaly detection:** AWS **Cost Anomaly Detection** (`aws ce get-anomalies` to investigate the current spike; create a monitor if none exists). GCP/Azure have equivalent anomaly alerts. For a live spike: filter anomalies to the window, get the root-cause dimension (service + usage type + linked account), and tie it back to step 1's delta.

### 7. Rank recommendations by effort vs impact
Produce a single prioritized table — do NOT dump a flat list. Columns: **Recommendation | Monthly $ saved (est.) | Effort (S/M/L) | Risk | Reversible? | Action/command**.
- Sort by impact-per-effort. Surface **quick wins** (delete orphans, gp2→gp3, add lifecycle, release EIPs) at the top — high $/low effort/reversible.
- Right-sizing and Graviton migration = medium effort, needs a perf validation step.
- Commitments = high-confidence savings but **financial lock-in** — flag explicitly and require human sign-off; never purchase autonomously.
- Give a total: "estimated $X/mo (Y%) recoverable, $Z of it as zero-risk quick wins."

## Common Errors

- **Right-sizing on CPU only.** If the CloudWatch agent / Ops Agent isn't installed, memory metrics don't exist — the provider tool fills gaps with assumptions. Downsizing a memory-bound app on CPU data alone causes OOM. State when mem data is missing.
- **`aws ce` returns near-zero / empty.** Cost Explorer must be **enabled** in the account and has ~24h data latency; first call after enabling shows nothing. Also CE is global (`us-east-1` endpoint) — region flags don't filter it. Tag-based grouping only works for **activated** cost-allocation tags (activation isn't retroactive).
- **Confusing detached vs in-use.** A volume `in-use`/disk attached to a **stopped** instance is still billed — "stopped" ≠ free for storage/EIP. Don't only filter `available`.
- **Blended vs unblended cost.** Use **UnblendedCost** for actuals; blended hides RI/SP allocation across an org and misleads per-account analysis.
- **GCP console export ≠ truth.** The CSV/console rounds and lags up to a day. Always query the BigQuery billing export for cents-accurate, SKU-level data.
- **Buying commitments before right-sizing.** Locks in your current (oversized) footprint for 1–3 years. Order matters: orphans → right-size → spot → *then* commit on the proven baseline.
- **Deleting "orphaned" snapshots that back an AMI / are a DR copy.** A snapshot can look unattached but be the backing store of a registered AMI or a cross-region DR copy. Check AMI block-device mappings and DR runbooks before deleting. Never bulk-delete snapshots in the analysis phase.
- **Reading egress as one number.** "Data transfer" bundles internet egress, cross-AZ, NAT processing, and inter-region — each has a different fix. Break it down by `USAGE_TYPE` before recommending.
- **Mutating during analysis.** This skill's job is to *recommend*. Don't terminate, resize, or purchase. All write actions are human-gated.

## Verify

- Every dollar figure traces to a real query/command output, not an estimate from memory — cite the command per recommendation.
- Savings estimates are **monthly** and net (post-discount), with the assumed commitment term/payment option stated.
- Quick wins are confirmed reversible (release EIP, delete unattached vol with a final snapshot, gp2→gp3) and separated from lock-in actions.
- The top spend services in the final report reconcile to the step-1 breakdown total (sums match the bill, ± rounding).
- No write/mutating command was executed; all destructive or financial actions are presented as proposed commands for human approval.
- Re-run the cost breakdown ~one billing cycle after changes land to confirm realized savings vs projected (close the loop).
