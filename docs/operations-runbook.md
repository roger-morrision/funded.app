# Release, incident and recovery runbook

## Release identity and deployment

Build from a clean canonical GitHub checkout with Node 24 and `npm ci`. Run the checks in README and generate `dist/release.json`. CI records the actual checked-out revision (including pull-request merge revisions); local reconstructed snapshots and `--allow-dirty` reports are not release candidates. The manifest contains source hashes but does not attest an on-chain program binary.

For containers, select an approved immutable Node 24 base image digest through the `NODE_IMAGE` build argument. Build once with `FUNDED_SOURCE_REVISION` equal to the checked-out revision, record the resulting image digest and retain it in the registry. Supply that same revision as `FUNDED_BUILD_ID`. The API and every receipt, fee, reward, buyback and community worker must use the same image digest. Build the app image before enabling worker profiles; workers consume that image and do not rebuild with different browser arguments. Historical Compose tag defaults are preview examples; set `FUNDED_APP_IMAGE` to the approved digest explicitly. Record separate program binary/program-data hashes and authorities for deployed contracts.

The application Compose healthcheck probes `/api/health` for liveness. Use `/api/status` for storage and RPC genesis verification and `/api/readiness` for production gate information. Probe public metadata URLs separately. None of these checks proves that a payout occurred. Alert separately on worker heartbeat age, failed/unknown submissions, unreconciled obligations, pending claim age and storage capacity. Keep direct backend ingress private if `TRUST_PROXY=true`.

Roll out the database schema with the old API and signing workers stopped. This release must apply `db/schema.sql` through `npm run db:migrate`: existing `auth_records_kind_check` constraints must be replaced so namespaced `chat-challenge:devnet` and `chat-session:devnet` records are accepted. Verify chat sign-in and replay rejection against the migrated database before restarting public traffic; `CREATE TABLE IF NOT EXISTS` alone does not upgrade the constraint. Include these records in the isolated restore drill. Verify migration and startup before enabling one instance of each worker; ensure a live lease is owned by only one instance. Verify public health, network identity, expected build ID, metadata reachability and one read-only financial reconciliation before reopening writes. Roll back to the previous image only when its schema remains compatible. Never roll back financial state to undo a confirmed chain transaction.

## Network and secret isolation

Use independent Devnet and mainnet projects, databases, storage prefixes, RPC keys, session credentials, program IDs and signing roles. Do not copy a Devnet database or reward ledger into mainnet. Verify `getGenesisHash` against the intended cluster before enabling a signer. Keep Devnet-only wallet signing, faucet relay, self-attestation and test-price overrides disabled on any public deployment. Mainnet stays disabled until audited artifacts and full acceptance evidence are approved.

Store secrets in the hosting platform's secret manager or mounted read-only secret files; never use `VITE_*` for a secret. Separate fee collection, reward authority, buyback and payout custody. Rotate credentials through the secret manager, restart consumers and verify the expected public authorities before resuming workers. For an exposed signing key, pause affected workers first; changing an environment variable alone does not rotate an on-chain authority.

## Durable hosting and metadata

Move the application and workers to continuously available hosting with managed PostgreSQL, private service networking, TLS, monitored ingress and encrypted off-host backups. Token metadata URLs must remain immutable and publicly retrievable. Preserve existing metadata paths when moving to redundant object storage/CDN; verify content hashes and test cached and uncached retrieval before routing traffic. A desktop volume, CDN cache or tunnel alone is not a durable source of truth.

## Consistent backup

Choose and record owner-approved recovery point and recovery time targets. Schedule encrypted off-host database backups and point-in-time recovery where supported. Back up the reward ledger at the same consistency boundary as PostgreSQL because automatic rewards may still use a separate file. Store recovery keys in a different failure domain. Record the image digest, Git revision, schema version, program IDs, ledger hash and snapshot time alongside each backup.

1. Pause API writes and stop every signing/indexing worker; wait for in-flight submissions to resolve or record their signatures as uncertain.
2. Use PostgreSQL's supported `pg_dump --format=custom` or managed snapshot facility. Supply authentication through protected service configuration, not shell history. Do not copy live PostgreSQL volume files as a logical backup.
3. Snapshot the stopped automatic-reward ledger and immutable metadata with checksums. Preserve ownership and directory layout.
4. Encrypt and upload backups off-host; verify checksums and retention. Reopen writes only after all components are captured.

## Restore drill

1. Provision a new isolated database and private application instance. Disable all transaction submission and external notification delivery before loading a backup; do not reuse production API credentials or publicly expose restored sessions.
2. Restore the custom PostgreSQL dump with `pg_restore --exit-on-error --no-owner` into the empty database. Restore the matching ledger and metadata snapshot. Never test by overwriting the active database.
3. Start the matching image without workers. Check schema, record counts, metadata hashes, obligation totals and known receipt IDs. Confirm public queries expose only the intended network's records.
4. Reconcile every unknown/pending transaction against the intended chain. Confirm finalized payments remain paid and replayed requests cannot generate a second transfer. A restored database can lag the chain; timestamps alone must not authorize resubmission.
5. Record actual data loss window and recovery duration. Enable workers only after transaction-by-transaction reconciliation and authority verification; an operator must approve a real recovery cutover.

## Incident response

Pause new financial writes and affected signers if network identity, program hash, custody, accounting or submission status becomes uncertain. Preserve public signatures, request IDs, logs and snapshots without credentials. Reconcile submitted transactions to finalized chain state before retrying. Inform users of affected actions and claim delays through the product status surface. Resume with the repaired image and verified ledger; keep an incident record and regression evidence.

## Repeatable local contract bytecode checks

The manual `Contract bytecode regression` GitHub Actions workflow builds and tests without deploying, loading signing credentials or contacting a Solana cluster. It pins Rust 1.97.1, Agave 4.1.2, SBF architecture v0 and platform-tools v1.54. The Agave Linux archive is checked against SHA-256 `5991d027a686eb419a709a479178b33eb83501e8a2bfbf599a81a286bfcbf770` before extraction. The build tool downloads its version-pinned platform tools. The workflow uploads only the tested `.so`, its hash and the canonical Git revision; local LiteSVM results are not chain-finalized receipts or an independent audit.

To reproduce on Linux, download and checksum the archive from `https://github.com/anza-xyz/agave/releases/download/v4.1.2/solana-release-x86_64-unknown-linux-gnu.tar.bz2`, extract it in a temporary tools directory, then run from `contracts/funded-fee-router`:

```sh
/path/to/solana-release/bin/cargo-build-sbf --manifest-path programs/funded-fee-router/Cargo.toml --arch v0 --tools-version v1.54 -- --locked
cargo test --locked
sha256sum target/deploy/funded_fee_router.so
```

The contract's `rust-toolchain.toml` selects Rust 1.97.1 for host tests. A full test requires the bytecode build first because integration tests embed the `.so`. For policy-only checks without bytecode, run `cargo test --locked --lib`. Compare reviewed bytecode and deployed program-data evidence separately before any authorized upgrade; a successful local build does not update Devnet.
