# Devnet automation with Redis — November 1, 2026

Verified at 2026-11-01T06:25:30.086Z. Financial services use source `6645520e5c4f8a172ee94b8adf710608999f84f2` and image `sha256:9724d6f9c699cde26d58bd57f211313f097f7451e9b013c347ae0bb458d6ccca`. The shared gateway uses `bd90a8d69de612f35ab9688c1a7e200a3833084a`. Redis was enabled throughout this campaign.

## Confirmed on-chain results

| Flow | Verified result |
| --- | --- |
| Standard / Pro / Premier | Real Pump launches, 20,000,000-lamport service fees and exact 3% community reserves. [Pro](https://explorer.solana.com/tx/s4tF3oSpfdx5Aev1sLbL78kn4Bg73JN2L5hCh56MtdSdcqxKAvqCzFp7ZAHGeoSsytPqXCVpTuYHYXQ8ktgjygm?cluster=devnet) burned 200 FUNDED; [Premier](https://explorer.solana.com/tx/4wWPv1cQueZpEiDpbySm55ikU1hVxDWCcRZDZ6UmpirBKPNd934Pukx6suZZ2TPvLFSa9tt33iCAZbS8vPVYdXyE?cluster=devnet) burned 399 FUNDED from its verified quote, atomically with each launch. |
| Collection and settlement | Three collections of 2,550,162, 148,149 and 148,251 lamports, including PumpSwap fees; all three fixed-policy settlements and their creator, operations, three-level referral, holder-funding and community-funding transfers finalized without later creator approval. |
| Automatic SOL payouts | 33 independently verified payments: 10 holder, 8 bonus, 3 creator, 9 referral, 3 operations. Their exact amounts and finalized receipts are in the JSON. |
| FUNDED burns | [Burn 1](https://explorer.solana.com/tx/3KRmNwAC7Y896rYvo9cRrxUWoAmER9dLvVzHG2x5muUqBKZZrA3fY3qgvHvty3x9581t6xwDYM3RWJva9wbgcsBH?cluster=devnet), [Burn 2](https://explorer.solana.com/tx/6rZHpopt7qbT7XnKoZVT1putfTHHsR4wRkBYHMpzp3ABiy9MzvuACiqBmvyAvfo5xXftjRFzPfqvSs3Db9oQvxm?cluster=devnet): 142328 lamports spent; 17995 base units burned. The second burn combined the two later collection budgets. |
| Own-coin agents | Both milestone purchases and burns finalized once, with exact vault debit and burn-instruction proof. Later worker cycles retained the same action signatures. |
| Migration and claim | [Real migration](https://explorer.solana.com/tx/4CWsruEk6xSpF75UCKmSG9GQ9GoYPnvUbaJxYFff29sMe5KJDXEcDzF8bwGGnh53Kxh1L42uqyejkok7sZmTBdb?cluster=devnet), exact slot 517387311, 20 recipients, 30,000,000,000,000 reserved base units. [Holder claim](https://explorer.solana.com/tx/8gd2LcmMTUxJNcmXivdMFVJAS8kLj4PELGTWQszCKMeFdLuo63UQ7zULYZhAvKWLD57we55n9RRhtLmttAxPL82?cluster=devnet) credited exactly 38,047 base units. |
| Expiry | Actual on-chain expiry 2026-11-01T05:33:42.000Z. [Permissionless sweep](https://explorer.solana.com/tx/QFxFxsdkN3pHHcN2niZC4qndZv9bNamJ8pxEV3aaj2bireVqma46WpwB1My6rYcdyjZ9Dt57JKUZGz72vxvftVe?cluster=devnet) credited exactly 29,999,999,961,953 remaining base units to the configured app owner. Early close, expired claim, tampered proof and replays were rejected. |
| X-linked rewards | Protected and current agency policies paid real SOL with the authorized labeled identity. Empty wallet deferred; funding the owned fixture resumed its original frozen claim exactly once. Wrong subject/signature, rebinding and replay checks passed. No OAuth or X posts. |
| Restart recovery | The app was interrupted after saving [this collection identity](https://explorer.solana.com/tx/62pKRBMqyHqugmRzocYnnNpnojAP1SWuJsWt5Qpzzp3kDewdoCR5nZ7WfypYHBdtsN1Pvg2RJvpbfhDz5dP56SWh?cluster=devnet). Its exact 148,251-lamport receipt was recovered and settled by the stock collector, with no replacement collection. The collector was also restarted; Docker events reconcile a concurrent frontend recreation. |

## Measured Helius request savings

| Mechanism | Avoided provider-call attempts |
| --- | ---: |
| Redis, incremental to the existing memory cache | 783 |
| Memory cache | 5032 |
| Identical concurrent reads | 3525 |
| Account batching | 8574 |
| Total | 17914 |

The gateway made **16780 provider requests** in the measured intervals. The optimizations avoided **17914 attempts (51.63%)** against the reconstructed 34694-attempt baseline. Redis alone contributed **783**; Redis hits are excluded from the memory-cache row.

Two controlled checks each requested 20 unique real finalized receipts after the five-minute memory TTL expired or after the gateway restarted. Each returned **20 Redis hits, zero memory hits, zero provider requests**, with identical result hashes. These 40 benchmark hits are included in the measured totals; the historical receipts are benchmark fixtures, separate from this campaign's new financial actions.

Counters were calculated separately for two gateway process instances and then summed. The observations include background workers, audits and benchmarks; about 31 seconds of old-gateway drain during replacement are excluded. Errors included 1 upstream failure, 0 provider rate-limit responses and 28 local queue rejections. Rejections are not counted as savings. These are request-attempt counts, not billed API credits or an invoice estimate.

## Fixes and validation

The gateway now uses a conservative Helius-specific read budget and independent send pacing, with one upstream HTTP connection. The chosen bounds remain below the documented [Helius RPC limits](https://www.helius.dev/solana-rpc-nodes) and [plan transaction limits](https://www.helius.dev/pricing).

Native SOL rewards smaller than the current account minimum now retain their immutable entitlement as awaiting recipient funding. One unrelated zero-balance Devnet trader still has **10,201 lamports pending**; that wallet was not funded or signed for. The owned empty-wallet case demonstrated exact resumption with no duplicate payment. Concurrent reserve changes briefly required reconciliation; the service subsequently returned active and paid the applicable completed bonus cycle without changing its manifest.

Collections now save their exact signed identity before broadcast. The stock collector reconciles pending receipts after restart, and that proof step has the same bounded two-minute HTTP budget as collection, settlement and disbursement. One receipt created by the earlier unjournaled implementation needed a one-time repair from independently verified finalized launch/router/transaction evidence; that repair submitted no transaction. The fresh restart test exercised the corrected path.

**421 financial regression tests** passed from the final isolated source, across 92 files. **53 Redis/gateway tests** also passed, including disposable real Redis. These suites overlap and are not added together. ProgramData remains `f0517fce9b8361be087456be2f5e5547af23b114ca1c0cf4ebaba5a42a8bd9ca`, matching the reviewed SBF binary `b4189944394dceddbf6c9d116957a5f6185d81a7257f377166e80d1a65388e0e`.

## Final runtime and limits

QA used five-minute holder/bonus windows, a scoped 100,000-lamport collection minimum, per-mint $1/$2 milestone thresholds and a 15-minute community window. Standard hour/day/90-day durations were not waited out. Normal global rules were restored atomically during test-mint initialization and verified at revision 10: $100k/$300k, 90 days and daily promotion. Runtime QA overrides are now disabled; hourly holder and daily bonus schedules are restored. The temporary API-only instance was removed.

The public app reports the final financial build, launch readiness and verified settlement evidence. Current frontend `bace2a0448f7b7ea812792429cc8d715d64d429d` was preserved. All active app services use the shared gateway; only the gateway mounts the provider credential. Redis has no public port and shares its internal network only with the gateway. The authority retained 4426448857 Devnet lamports, above its protected 3 SOL reserve. New participant keys stayed in memory and were disposed when the test process exited. Mainnet was not used. Changes are committed locally; no push was requested.

Full public evidence: [acceptance JSON](devnet-redis-financial-e2e-2026-11-01.json).
