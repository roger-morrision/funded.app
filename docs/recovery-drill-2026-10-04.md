# Isolated backup and restore drill — 2026-10-04

This exercise restored synthetic data into a new PostgreSQL database and verified
the app after restart. It does not establish recovery of the deployed service or
authorize financial execution. No app database, deployed container, external RPC,
signing key, or real transaction is used.

## Reproduce

Prerequisites: installed Node dependencies and a healthy local Docker socket at
`/var/run/docker.sock`. The script uses `postgres:16-alpine`; Docker's configured
proxy and registry settings remain in effect. It does not read `DATABASE_URL` or
`.env.local` and accepts no existing database/container target.

```sh
node --test tests/postgres-recovery-guard.test.mjs
node scripts/verify-postgres-recovery.mjs --run --report /tmp/funded-recovery-report.json
```

The script creates a random, ownership-labeled container with a random loopback
port and generated test password. Its only databases are freshly created drill
source/target databases. A custom-format `pg_dump` archive and reward ledger copy
are stored in a private temporary directory. The source database and original
reward file are deleted before restore so verification cannot read the originals.
The restored container, anonymous volume, temporary password file and synthetic
archive are removed before a successful report is emitted. Cleanup verifies the
container's ownership label before removal; it never removes unrelated containers.

## Checks

- Every row in every public PostgreSQL table matches the quiesced source snapshot,
  including keyed ledger records, projections, paid claims, obligations, referral
  claims, private auth records, worker checkpoint and cached receipt proof.
- Startup migrations run through two restored store instances and preserve the
  authoritative ledger. Metadata payload and image bytes retain their SHA-256
  relationship. The separately backed-up automatic reward file matches its digest;
  its fixture funding source and amount still match the PostgreSQL collection.
- Restored auth challenges remain atomic across replicas. All restored auth rows
  are then invalidated before simulated reopening, preventing old sessions from
  being resurrected by a restore.
- A paid claim cannot be reverted to a payable state. Twelve concurrent chat
  appends and a scoped/legacy writer overlap preserve all messages and ledger data.
  Restored receipt-worker leases exclude a competing owner.
- A restarted automatic reward worker reconciles a previously submitted batch
  using a **mocked** matching finalized proof. A second restart preserves paid
  status. The adapter records exactly zero submission calls. This tests restored
  worker state semantics, not actual on-chain exactly-once delivery.

## Evidence and operational limits

The machine-readable result is in
[`recovery-drill-evidence-2026-10-04.json`](recovery-drill-evidence-2026-10-04.json).
It records the observed PostgreSQL version/image, row counts, archive digest,
measured fixture backup/restore times, verification outcomes and cleanup status.
The small local timings are not production recovery-time or recovery-point targets.

The drill intentionally stops all fixture writers before copying PostgreSQL and
the separate reward ledger. A live deployment must coordinate a write pause or
another documented consistent snapshot boundary across **both** stores. A database
backup alone does not recover the automatic reward JSON sidecar. Never remove a
reward lock file merely because it is old; inspect the stopped worker first.

Before restoring a deployed system, retain a new pre-restore backup, stop signing
workers, restore into isolation, invalidate restored authentication, and reconcile
post-backup on-chain activity before enabling execution. Restoring an older ledger
can otherwise resurrect already-paid work. This fixture does not establish live
WAL/PITR coverage, post-backup reconciliation against real RPC, backup encryption
and offsite retention, provider failover, external metadata hosting durability, or
production-sized restore capacity. Those require deployed infrastructure access
and an operator-owned recovery procedure.
