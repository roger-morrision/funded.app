# Mainnet conversion attempt anchor: provisioning and cost proposal

**Status: proposal only, 23 November 2026.** No account, bucket, credential,
signer, transaction or service has been provisioned. This document does not
authorize Mainnet signing or activation. The source-linked failure is described
in [the attempt-anchor design](token-conversion-attempt-anchor-proposal.md).

## Owner-selected Docker test scope

The owner selected the existing single Docker host for a **local test** of the
two-store adapter. Two test containers with separate named volumes can exercise
conditional writes, version/delete-marker inventory, partial acknowledgment,
fork refusal and journal restore. They do not establish two independently
administered immutable copies: [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
are stored on the daemon host, and [daemon access](https://docs.docker.com/engine/security/)
can control host storage. A coherent host or administrator rollback could erase
both test volumes. Do not put production signer credentials or financial attempts
in this local fixture.

A Docker-based production design would need separately administered hosts and
storage domains, each with versioned WORM retention and independent recovery
access, or one Docker store plus a separately administered remote immutable
store. An S3-compatible service such as
[MinIO AIStor](https://docs.min.io/aistor/administration/object-locking-and-immutability/)
documents compliance retention and
[conditional PUT](https://docs.min.io/aistor/developers/s3-api-compatibility/),
but its license, hosts, backup and operating costs are not quoted here. The
current plan's production database, backup and signer references remain null;
the local Docker choice is not a production provisioning decision.

## Recommended smallest dedicated service

Use two **new, private S3 Standard buckets in separately administered AWS
accounts**, with Versioning and a bucket-default 365-day **Object Lock compliance**
retention on both. The reference price below assumes both buckets in US East
(N. Virginia); a second Region reduces common-region exposure but needs its
own regional quote. The two accounts must not share the application's Docker
volume, PostgreSQL administrator, backup credential or routine operator role.
The current source has **no approved AWS account or credential reference**.

The conversion controller and role services would write each unique,
content-addressed event to both buckets and wait for **both successful PUT
acknowledgments** before a role signs, before a send, and before marking a proof
complete. This is synchronous dual publication, not S3 Replication: AWS says
native replication is asynchronous and cannot be the only no-loss copy at the
signing boundary. Each event has the reviewed release context, message hash,
stage, prior event digest and canonical bytes or a retained content-addressed
payload. A first-provisioning marker is also written to both buckets. The
service permits one writer per reviewed attempt; a fork or partial dual write
stops fresh signing until reconciled. This is an implementation design, not an
implemented adapter.

Object Lock protects **versions**, while a new version or delete marker can
still be created. Therefore the runtime must use unique object keys, a
conditional first write, restricted `PutObject`/read/list permissions without
`DeleteObject`, and compare all versions and delete markers on recovery. Each
bucket's administrator is separate from the runtime credential. The two
inventories and event hash chains must agree before fresh work resumes. A
missing or uncertain acknowledgment leaves the attempt unresolved; it never
permits a new signature or blockhash. AWS documents strong read-after-write
for GET and LIST after a successful PUT; it does **not** make writes across two
buckets atomic. Reconcile partial writes read-only.

For recovery, quiesce the controller and both signer services; inventory both
buckets and three local journals; verify context, retention, versions, complete
chain, exact signed wire, and any finalized transaction/proof. Restore journal
state only from validated anchored bytes. Test a coherent rollback of all
three journals and a missing/corrupt/older bucket, with no fresh signing. The
backup administrator retains the second bucket's independent access and
performs a documented restore drill. One year is a **proposed owner choice**,
not an existing retention policy. Any attempt still unresolved before expiry
needs its locked versions' retention extended before that deadline; if an
extension is uncertain, fresh signing stops. The continuing storage cost of
such older attempts is a contingency beyond the model below.

Use SSE-S3, which AWS applies to new S3 objects without a separate encryption
charge. If the owner requires customer-managed KMS keys, quote both keys and
KMS requests separately. Do not put secrets or private signer material in the
anchor objects; retained signed messages and public account/state evidence
still need restricted read access.

## Reference monthly cost, excluding taxes and traffic

This is a **usage model**, not a spending approval or a guaranteed bill. An
[AWS November 2026 example](https://docs.aws.amazon.com/solutions/latest/prebid-server-deployment-on-aws/cost1.html)
uses **$0.023/GiB-month** for S3 Standard in US East (N. Virginia); the
[AWS S3 price page](https://aws.amazon.com/s3/pricing/)
uses **$0.005 per 1,000 PUT**, and gives **$0.0004 per
1,000 GET**. The S3 price page bills LIST like PUT and says there is no
minimum charge. Price and chosen Region must be rechecked before
provisioning. Assume 10,000 attempts/month, eight immutable 4 KiB events per
attempt, synchronous writes to two buckets, 365-day rolling retention (twelve
monthly cohorts for the illustrative steady state), 20,000 GET and 1,000 LIST
per bucket each month:

| Component | Calculation | Reference USD/month |
| --- | ---: | ---: |
| Locked storage, both accounts | 10,000 × 8 × 4 KiB × 2 × 12 / GiB = 7.324 GiB; × $0.023 | $0.1685 |
| PUT, both accounts | 10,000 × 8 × 2 / 1,000 × $0.005 | $0.8000 |
| GET, both accounts | 40,000 / 1,000 × $0.0004 | $0.0160 |
| LIST, both accounts | 2,000 / 1,000 × $0.005 | $0.0100 |
| **Modeled S3 subtotal** | | **$0.9945** |

The model counts every immutable version retained for the full period and
does not take an AWS free-tier credit. It omits network egress to the current
host, logging/monitoring, support, taxes, recovery reads, KMS if selected,
regional differences, extra versions/failed requests, and operator labor.
The actual event count and byte distribution must be measured from frozen
intent/journal fixtures before setting a budget. Under the model, every extra
10,000 attempts/month adds about **$0.9945/month** at steady one-year retention.
The S3 price page lists storage, requests, data transfer and other features as
separate billable components. Account creation is an administrative dependency;
we found no approved billing account or cost ceiling in the release plan.

## Existing-host comparison

| Option | Incremental service charge | Recovery and failure domain | Decision |
| --- | --- | --- | --- |
| Reuse Devnet PostgreSQL 17 / Docker volume | No new quoted provider charge; host disk, backup and labor remain unpriced. | Same host/backup administration and Devnet scope; a coherent three-journal restore can also restore this database. | **Not approved** as the production anchor. |
| Reuse the separate nonprogram Mainnet database | No new quoted provider charge; existing workload/backup costs unknown. | Existing service has no approved conversion attempt contract or independent retained backup. | **Not approved** as the production anchor. |
| New on-host PostgreSQL database and volume | Host capacity, WAL/backup disk and administration unquoted. | A separate volume alone shares host, administrator and restore path; it needs an external immutable synchronous copy to meet the no-loss boundary. | More moving parts than direct dual S3. |
| New dual-account Object-Locked S3 | Modeled $0.9945/month at the stated workload plus omitted charges. | Separate administration and retained immutable versions; both writes must be acknowledged before signing. | **Recommended for review**, not yet selected/provisioned. |

Cloudflare R2 Standard advertises 10 GB-month, one million Class A and ten
million Class B operations per month free, then $0.015/GB-month, $4.50/million
Class A and $0.36/million Class B. Its bucket locks can be removed by an
account administrator. That makes R2 a possible priced alternative, but it
does not replace this proposal's separate no-loss administration and restore
test. No R2 account is approved here either.

## Exact owner decision and engineering acceptance

The owner needs to choose **the primary and backup billing accounts and
administrators**, whether the backup must be in another Region, the immutable
retention period (365 days proposed), monthly spend ceiling, and the approved
credential resolver and recovery operator. Provide only public bucket/role
references; never put access keys in Git or chat. The release owner then
freezes a fresh quote for the selected Regions and actual measured event
volume. This choice is separate from Solana wallet top-ups and does not grant
financial transaction authority.

Engineering then implements the S3 adapter and explicit provisioning mode,
with least-privilege policies, dual-ack fail-closed ordering, two-controller
fork handling, fresh-process/volume restore, corrupted/partially restored
bucket cases, coherent three-journal rollback, and retained unknown attempts.
Independent acceptance must confirm bucket configuration, actual account
separation, one-year retention or chosen period, real write/read/version
behavior, a no-loss backup/restore drill, and the final production
configuration. Until those checks pass, `mainnetActivationAuthorized` remains
false.

## Current primary sources

* [AWS S3 pricing](https://aws.amazon.com/s3/pricing/) and
  [AWS S3 pricing FAQ](https://aws.amazon.com/s3/faqs/): rates, cost components,
  replication and region charges.
* [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html):
  Versioning, compliance retention, new versions and delete markers.
* [S3 consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
  and [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html):
  acknowledged PUT/GET/LIST and first-write preconditions.
* [S3 replication considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html):
  native replication is asynchronous.
* [S3 default encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html):
  SSE-S3 is included.
* [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
  [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/):
  alternative rates and mutable administrative lock rules.

The source comparison uses [workspace deployment](workspace-deployment.md),
`config/mainnet-deployment-plan.json` and the current conversion journal and
bootstrap modules at the branch base. Web prices and terms are observations as
of this document date; they must be refreshed before purchase.
