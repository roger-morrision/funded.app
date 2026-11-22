# Durable expiry attempt and exact transaction attribution

FQA-MN-005/MN-003 source integration; **local-only, not a financial release**.
This follows independently accepted equality/address construction at `2ca05602`.
No Contract bytes, loader quote, production manifest, runtime pool map, cap or
financial authority changes. Mainnet admission remains disabled.

## Runtime path

`expireUnpayableCycles` passes the existing locked schedule store into
`createAutomaticRewardChain.expireCycle`. The chain delegates to
`executeRewardExpiry`; no parallel queue or ledger owner is introduced.

Before a new submission, normal readiness, historical account binding, pause and
grace checks remain mandatory. The signed legacy message is frozen and validated
as precisely the single five-account expiry instruction. Its public wire bytes,
signature, blockhash/validity, manifest/network/program binding and owned-account
snapshot are atomically written/fsynced to that schedule's `expiryAttempt` before
`sendRawTransaction` can run. A complete fee quote must fit above the operator's
protected 3 SOL reserve. Payer/admin/price balances cannot substitute for it.
Failure to persist prevents broadcast. Concurrent writers cannot replace an
existing attempt, even if both have prepared an in-memory signature.

Every later call reads that saved attempt first. Unknown, failed, unavailable or
status-only outcomes retain it; they do not fetch a fresh blockhash, sign again,
rebroadcast, release a budget or claim completion. This conservative slice does
not automatically clear failed/expired attempts: any future replacement needs an
explicit reviewed reconciliation policy. No assertion of a fee refund is made.

`finalizedExpiryAttempt` requires the exact signed message/signature in the
actual finalized transaction, successful status at the same slot, fresh matching
program context effective before that slot, and unchanged instruction account
balances except the operator's actual fee. Extra instructions/CPI, custody moves,
changed fees/balances or a later deployment cannot authenticate this attempt.
The independently owned account read must then show the exact unpaid liability
release with unchanged paid amounts, immutable cycle/vault state and custody.
The attributed proof is durably saved before the scheduler marks the row expired.

An inactive cycle without a saved attributed attempt is reported unresolved,
never silently attributed to this worker. A matching verified saved proof can be
read idempotently after restart. Read-only Mainnet proof reconciliation may read
paused state; the default fresh-construction path continues to reject pause.
Historic operator rotation or changed deployment context that cannot authenticate
the saved message remains unresolved rather than authorizing another signer.

## Focused evidence

Three unchanged regression bodies fail against exact `2ca05602` chain source
(only fixture import prefixes redirected): unknown recovery obtains another
blockhash/submission; an unattributed inactive cycle reports completion; a store
write failure does not prevent the old submission. All are corrected in this
source path. The old failing source/output is retained.

Run Node 24.22.3 with the three hash-checked public fixture inputs documented in
the preceding expiry/paired handoffs:

```text
node scripts/security-tests.mjs --inventory config/reward-expiry-recovery-tests.json
```

The explicit inventory covers 12 context/timing/adapter and 17 durable recovery
cases: actual ephemeral signatures, locked file writes/restart/concurrency,
unknown timeouts before/after landing, unavailable transaction/status, changed
signed messages/account effects/program slots, corrupt journal, reserve threshold,
scheduler attribution and a paused synthetic Mainnet proof. No real endpoint,
wallet, balance, deployment or chain execution is used. Current public `3f8a` ELF
bytes are hash-pinned, while review, account bank, RPC and financial facts remain
synthetic. Reusing the independently accepted Contract artifact does not make
these mocked results live acceptance.
All 29 required cases pass with zero failures/skips/TODO. Missing the required
current public ELF fails closed with zero required passes. Optional program-
evidence RPC environment overrides must be unset; fixtures reject them before
an execution path could instantiate a network evidence provider.

## Remaining release work

Independent review of this exact source and actual configured-program live
financial acceptance remain required. The existing historical payout/receipt
cleanup derivations, authenticated original bank/complete replay inputs, full
28-leaf delivery, holder paging/scale, production operational/price/guardian
custody, final per-wallet message quote and backup/restore/release packet are
separate open dependencies. No new signing or spending is authorized here.
