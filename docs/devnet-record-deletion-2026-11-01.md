# Permanent old Devnet app-record deletion — November 1, 2026

The user explicitly selected permanent deletion of the 20 previously archived Devnet launches. The live database transaction committed at 07:01:58 Bangkok time on November 1. The Solana mints, program accounts, balances and transaction history were not changed by this cleanup.

Removed from live storage:

- 20 launch rows and 40 collection rows.
- 296 keyed token-related ledger records, including settlements and payout records.
- 18 stored metadata records, 20 market-cache rows, 40 receipt proofs and 50 queued post records.
- 6 holder programs, 14,315 reward schedules, 6 holder snapshot groups, 20 reward pools and 4 community-drop records.
- 3,542 bonus snapshots, 363 bonus indexes, 3,179 settlement indexes and 10 bonus assignments.

Shared watchlist and index-cursor records were scrubbed of old token references. Unrelated records and account configuration were retained. The maintenance job used the exact 20-mint inventory, stopped the app and its three financial workers, matched a fresh deletion-plan hash, held the database advisory lock, and verified zero remaining references to the old mint and receipt identities in all inspected live tables and the reward ledger. All four services restarted with their existing images. App health returned HTTP 200, the active launch list was empty, and old launch/metadata endpoints returned HTTP 404.

The guards were deployed as `fundedapp-devnet:delete-old-155fdcaa`, source revision `155fdcaa8ad6c1ba35a9bc4c7eb036c9691425ff`. They exclude the deleted mint addresses from launch registration, metadata creation and automatic unindexed buyback discovery. The exclusion inventory contains addresses only; it does not retain launch metadata, receipts or payout records. A live attempt to re-register a deleted mint returned HTTP 410. Post-deployment checks confirmed zero launch rows, collection rows, holder programs, schedules and bonus snapshots; 19 unrelated referral-wallet records remained, and the app was healthy.

The October 31 archive backup remains. Automatic approval review rejected destruction of that backup because it was not explicitly authorized; separate user approval has been requested. No claim that the backup was deleted is made.

Detailed counts and the applied plan hash are recorded in ignored `tmp/devnet-permanent-purge/applied.json`. No on-chain transaction was submitted for this deletion. The existing deployment/upload task remains blocked: a fresh November 1 check of all four configured Helius keys still returned HTTP 429 quota errors.
