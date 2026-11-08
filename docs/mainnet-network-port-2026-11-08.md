# Mainnet network port — 8 November 2026

Status: **preparation in progress; Mainnet remains NO-GO**. This change does not enable production transactions or claim that the remaining network port is complete.

## Implemented

- Program evidence accepts an explicit network, verifies Mainnet genesis before account reads, and requires any alternate provider to match that network. The Devnet evidence endpoint is not inherited by Mainnet.
- Finalized collection verification binds the launch and RPC to the requested network before accepting financial evidence.
- Allocation plans and automatic action selection support explicitly labelled Mainnet records. Unlabelled historical records remain Devnet-only; mixed-network settlements are rejected.
- Allocation reconciliation binds Mainnet chain reads and saved collections/settlements to the selected network. Existing amount conservation and immutable-allocation checks remain in place.
- Community claim preparation and indexing bind manifests and evidence to their network. Mainnet rejects QA cutoff settings, QA snapshots and Devnet manifests. Program-proof caches include the cluster.
- Wallet history and token market reads support the selected network. Mainnet token-account reads and market scans verify RPC genesis; persisted market snapshots must match the route's cluster.
- CI runs all application test files, including network, financial and actual isolated API/WebSocket write-boundary tests.

These core modules are preparatory building blocks. Production financial workers and launch endpoints have **not** been activated. Backend Mainnet mutation and transaction forwarding guards are unchanged.

## Validation boundaries

The JavaScript checks exercise mocked financial/network boundaries and an actual isolated local HTTP/WebSocket server. Production-feature compiled-bytecode tests use the public test identity in `config/contract-build-candidates.json`; that identity is not deployable. Neither suite is an independent audit, a current full financial acceptance run, or a Mainnet canary.

The existing production-input inventory remains `config/mainnet-deployment-plan.json`. Its quoted reference binary is historical; it must not be confused with the latest production-feature test binary or the eventual production artifact.

## Remaining dependency sequence

1. Supply production program ID, upgrade-authority public address, payer signer reference, fee recipient, FUNDED mint, origin, isolated RPC/database/metadata secret-file references, spending limits and independent reviewer/report. Do not place key material or credential values in these files.
2. Bind the actual reviewed production identity and bytes into escrow and agency trust checks. Finish launch submission/registration, metadata registration, financial worker entry points, payout routes and their call-site network plumbing. Existing Devnet-only gates must not be removed by a broad text replacement.
3. Build the final identity using `scripts/build-mainnet-contract.sh`, reproduce bytes in CI, complete independent custody review, and refresh rent and message fee estimates. Existing reference binaries are not production approvals.
4. Run every case in `config/mainnet-acceptance-plan.json` on the reviewed Devnet candidate, with finalized balance/state evidence and compute-budget measurements. Historical receipts and mocked tests cannot substitute for missing cases.
5. Prepare isolated read-only Mainnet staging and run `scripts/mainnet-readiness-preflight.mjs --online` against that explicit configuration. It cannot enable writes.
6. Review the exact release, program ID, authority, signer reference and capped spend. Deploy only with that concrete authorization, verify finalized ProgramData and initialized state, then run the capped canary before any public activation.

The acceptance plan names the financial cases and stop/recovery conditions. Its null identity and spending fields are deliberate blockers, not defaults to guess. Rollback begins by stopping new writes and reconciling submitted signatures; it does not automatically downgrade an on-chain program.
