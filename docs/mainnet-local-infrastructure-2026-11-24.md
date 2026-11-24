# Same-server infrastructure and historical payout recovery

Follow-up: the owner has accepted the same-server backup failure domain, and
operational file custody is now provisioned and verified. See
[the custody and eligibility update](mainnet-custody-and-history-2026-11-24.md).
The observations below describe the earlier preparation checkpoint.

24 November 2026. The owner selected Docker on the existing live server.
Preparation is partially completed; full-program Mainnet remains **NO-GO**.
The existing richpad.fun nonprogram service and funded.vip Devnet service were
not switched or reconfigured. No financial transaction was submitted.

## Provisioned infrastructure

The separate `richpad-program-mainnet-prep` Compose project contains PostgreSQL
17.11 and Redis 8.10.3, pinned to the existing host's immutable image digests.
It has a private internal network, no published ports, separate persistent
volumes and newly generated database/cache credentials. PostgreSQL is limited
to 384 MiB and 0.5 CPU; Redis to 160 MiB and 0.25 CPU, with swap disabled.
The application database role cannot create roles/databases or act as superuser.

The host directory is
`/opt/richpad/program-mainnet-preparation/infrastructure-20261124`.
Its root-only secrets remain on that server. Connection references and image
digests are in [the preparation inventory](../config/mainnet-infrastructure-preparation.json).
The production release manifest and Mainnet activation flags remain unchanged.
No app or signing worker is connected to this preparation namespace.

The database has the current 22-table schema and no imported financial records.
Some current schema features remain Devnet-specific; creating these tables does
not implement or approve their Mainnet application paths.

## Backup and restore verification

`richpad-program-prep-backup.timer` runs daily at 03:15 UTC with up to five
minutes jitter. Its first service run succeeded. Backups include a PostgreSQL
custom-format dump, Compose configuration and the new database/cache access
configuration. The backup directory is private, manifests retain SHA-256 hashes,
and no automatic deletion is configured. Monitor disk use before connecting a
production workload.

Two isolated restore checks passed. The first restored all tables and three
synthetic rows, including a null and Unicode value. The test table was removed.
The second restored the actual scheduled backup into another fresh container
and volume with networking disabled: all 22 table owners and row counts matched,
and the restricted application role could read each table. Disposable restore
containers and volumes were removed. Existing live container images/builds and
health were unchanged.

These tests cover database recovery, not financial signer journals or coherent
rollback of all signing records. Both volumes and backup files share the same
server and administrator. They are **not an independently administered immutable
backup or a no-loss conversion attempt anchor**. Docker stores volumes on its
daemon host; separate local volumes do not remove that shared dependency.
[Docker volume documentation](https://docs.docker.com/engine/storage/volumes/).

On the existing server, inspect the timer with
`systemctl status richpad-program-prep-backup.timer`; run a manual backup with
`systemctl start richpad-program-prep-backup.service`. The installed script is
`backup-database.py` in the host directory above. Never restore over a live
database: use a new isolated container/volume and verify the retained manifest,
roles, owners and data before considering a switch.

## Signer custody

Six existing local identity files were validated against the selected public
identities: deployment payer, upgrade administrator, program, operator, price
attestor and guardian. All six public keys are distinct. File access rules were
inspected; no broad Everyone/Users grant was observed. Private resolver paths
are retained in `.secrets/mainnet-preparation-20261124/custody-references.json`.

No signing keys were generated, transferred to the server or used to sign.
These local files do not establish independent operator/attestor custody, and
the guardian's filename does not make its storage offline. Production signing
services remain unprovisioned pending the reviewed custody and runtime setup.

## Historical community records

The bounded search inspected 126 local JSON files (87,595,002 bytes), retained
Devnet backup member inventories, and five server database backups dated
19–23 November. No complete original raw eligibility bank at any of the six
required historical slots was found. This is a search of the listed sources,
not a claim that no external archive exists.

All three retained 28-leaf allocation sets reproduced their Merkle roots and
proofs, and their original migration transactions were reverified as finalized.
Current finalized reads found no drop/payment accounts for the first two retained
sets. The third drop (`oD4Sz38s…`) is closed, with three payment accounts and
25 leaves without payment accounts. The three original transactions also passed
canonical instruction and transaction-local recipient/vault token-delta checks,
totalling 876,464 base units. This does not authorize paying the other leaves or
reopening the expired window.

The original complete eligibility-bank bytes, supply completeness and replay
provenance remain missing. Recomputed roots prove consistency of retained wallet
aggregates, not completeness of the original bank. Helius's current historical
account API is Mainnet-only and cannot supply these Devnet records.
[Helius historical account documentation](https://www.helius.dev/docs/rpc/historical-accounts).

The exact observed slots, hashes, payment counts, infrastructure digests and
restore results are in [the evidence record](evidence/mainnet-local-infrastructure-2026-11-24.json).
Full per-leaf reconciliation and finalized transaction evidence remain under
`tmp/mainnet-preparation-20261124/`. The next historical input must be an
authenticated original Devnet bank/replay archive; a fresh controlled Devnet
financial acceptance run would be a separately scoped operation.
