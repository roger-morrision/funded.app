# Devnet readiness — 2026-10-04

The current goal is to verify the complete Devnet journey before a mainnet release. Mainnet remains disabled. This document describes code and operational gates; it is not an independent audit, a deployment record, or evidence that a transaction settled.

## Release evidence

| Area | Implemented in this change | Acceptance evidence still required |
| --- | --- | --- |
| Source/release identity | Node 24, lockfile installs, clean canonical source manifest, browser/API/worker source hashes, CI artifacts | CI on the final GitHub commit; immutable container and contract artifact digests |
| Automated verification | Syntax, unit, critical policy, isolated HTTP release, Chromium browser, isolated PostgreSQL jobs | Attach actual final test results and distinguish mocked browser tests from live wallet tests |
| Dependency maintenance | Scheduled production dependency audit and Dependabot updates | Review upgrades and contract dependency advisories |
| Container operation | Non-root application, liveness probe, build revision label, explicit Devnet cluster | Remote host, image digest, database/storage services, worker supervision and alerts |
| Persistence/recovery | Existing PostgreSQL storage; documented consistent backup and restore procedure | Successful isolated restore drill, encrypted off-host backups and recovery targets |
| Public availability | API status reports storage and network observations | Latest external probe reported Cloudflare error 1033; restore ingress and recheck public API and metadata origins |
| Devnet financial journeys | Repository contains launch/trade/fee/reward/claim/buyback verification scripts | Fresh finalized signatures and exact balance, supply, recipient and ledger deltas for every enabled journey |
| Contract security | Canonical contract directory, source validation work | Independent security review, deployed program-data hash, authority and custody evidence |
| Production | Mainnet writes remain disabled | Separate production services and credentials, approved program IDs, independent audit, mainnet acceptance and operator sign-off |

The managed environment reports no configured production credentials or provider identities. Hosting, durable object storage, production RPC, wallet custody, and completed independent audit have not been established. A calendar target does not satisfy these gates.

## Test evidence policy

Record the final canonical commit, command, network, pass/fail/blocked result and artifact path. For an on-chain test, include public payer/mint/recipient addresses, finalized signature, slot, exact before/after base-unit balances or mint supply, and the corresponding ledger/receipt IDs. Do not record keys, session cookies or provider credentials. Faucet throttling, missing signers, unsupported test fixtures and unreachable services are blocked checks, never passes.

A liveness response proves that the API can respond. `/api/status` checks storage and RPC network identity; neither endpoint certifies settlement, payout workers or a mainnet release. Record worker heartbeats, lease ownership, pending obligation age and reconciliation results separately.

## Required Devnet sequence

1. Restore public ingress and metadata reachability; verify database and network identity.
2. Verify clean build, isolated server, browser routes, PostgreSQL concurrency, replay/expiry/wrong-wallet protections and accessibility.
3. Use fresh disposable wallets and faucet-funded Devnet SOL. Record the exact funding budget and balances.
4. Exercise Standard and paid-tier launch, interrupted launch registration recovery, buy/sell with fresh quote, listing/boost payment and replay rejection.
5. Verify collection and all enabled recipient routes before/after graduation, reward allocation, community claims, X/referral claims and buyback burn. Mark unavailable graduation fixtures or unconfigured integrations explicitly.
6. Restore a backup in isolation, restart workers and verify obligations are reconciled without duplicate transfers.
7. Publish the result matrix for the exact deployed image and contract version. Keep mainnet disabled while any required gate is unresolved.

See [operations-runbook.md](operations-runbook.md) for the release and recovery procedure. Historical reports describe earlier deployments and do not override current observations.
