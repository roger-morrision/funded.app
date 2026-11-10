# Mainnet preparation and Devnet recovery checks — 10 November 2026

Mainnet remains disabled. Production identity, signer, custody, backup destination and independent-review references remain placeholders. This report adds verification to the earlier [readiness report](devnet-readiness-2026-11-10.md); it does not turn historical or isolated tests into final Mainnet acceptance.

## Changes

- Bonus snapshots, evidence indexes, queues, funding proofs, payment histories and receipt fallbacks now bind to the selected network. Legacy unlabelled bonus records are accepted only on Devnet. QA periods are forbidden on Mainnet. The live bonus runtime and price signer retain their Devnet-only activation barriers.
- Bonus preview reads skip finalized settlements from earlier days and cache independently verified immutable receipts. Financial snapshot indexing still verifies the complete applicable window. A public-Devnet read against the restored app state took 5.337 seconds / nine RPC requests initially, then 0.619 seconds / one RPC request with the same verified result.
- Recent token activity reads the current 24-hour window plus one earlier receipt per route. Missing historical baselines remain unknown and omitted older history remains partial. Receipt identity, time, execution status and successful event ancestry are checked before counting trades. A public-Devnet RICH scan completed in 6.229 seconds / nine RPC requests, with complete empty 24-hour coverage; this is not a claim of complete all-time history.
- Launch promotion copy now states that the admin posts X promotions manually. Automated X posting remains disabled.
- The launch acceptance plan explicitly requires Daily bonus acceptance. Historical evidence summarization preserves failed attempts and incomplete coverage.

## Backup and receipt verification

The new `scripts/devnet-backup-restore.py` creates a consistent snapshot with financial writers stopped, restarts those writers, then restores the database and reward/signer files into isolated storage. It validates exact database row fingerprints and filesystem hashes, rejects archive traversal/links and unfinished journal writes, and exposes no restore port.

The first rehearsal identified a valid empty signer journal that the script had rejected; writers resumed and the check was corrected. The subsequent rehearsal passed on the remote server and after copying the private backup to the owner's local machine: **26 tables, 1,404 rows**, all row fingerprints and file hashes matched. All nine live services resumed healthy. Private backup contents and credentials are excluded from Git. A scheduled production backup destination, retention policy and operator still need to be configured.

Using the restored ledger and current readers, **12 historical Daily bonus receipts** were checked against finalized payment accounts, transactions and exact recipient deltas. All passed. This was a read-only recheck, not a new payout or a fresh complete UTC-day test. Snapshot hashes remained unchanged for all four saved Devnet snapshots.

The machine-readable [completion checks](evidence/devnet-completion-checks-2026-11-10.json) contain the restore and read-only measurements.

## Validation and remaining gates

The local suite passed 406 JavaScript tests and two Python archive/restore tests. Source syntax and size checks, the frontend build and read-only Mainnet preview build passed. Tests that inject a chain implementation are mocked and are not live transaction evidence. Contract source and deployed program bytes were not changed by this release.

The full-hour holder test and final deployment verification are recorded separately when complete. A fresh live buyback at the normal 5 SOL threshold is outside the approved 0.65 SOL financial-test budget. Earlier isolated curve and migrated-pool buyback receipts remain historical evidence; they do not prove a new production-threshold execution. Real X identity acceptance, the final production program/mint/pool and custody configuration, independent exact-bytecode review, final-release acceptance and a bounded Mainnet canary remain outstanding.

Automatic approval review rejected a proposed conditional Mainnet price-signer activation because this release must keep Mainnet disabled. The proposed activation was not applied. Production signing activation remains a separate reviewed launch step.
