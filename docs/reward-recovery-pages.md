# Bounded saved payout recovery

FQA-MN-001 source candidate, following independently accepted per-holder selection
at 0742d416. A scheduler execution now visits at most 32 saved payout attempts
across the selected schedules before checking fresh-work readiness. Every call
still passes `recoveryOnly:true` into the unchanged actual chain/journal path.
A cursor cannot create an attempt, refresh a blockhash, sign or send a transaction.

Work order is deterministic over schedule ID, original global index and recipient.
For larger queues the existing locked/fsynced store checkpoints a circular cursor
before returning a detached bounded group. Unknown attempts retain their original
markers and cannot starve later schedules. Concurrent store instances select
different initial groups. Explicit selected IDs filter schedules before their
manifests are touched, so unrelated malformed records cannot break that selection.
Ambiguous duplicate identities and corrupt paging state are refused.

For at most 32 tasks the existing read-only cache path remains free of cursor
transactions. Completed matching payment metadata and exact-proof checks are
unchanged. For larger queues there is one additional cursor transaction and a
second state read under the lock; existing per-result journal/error persistence
still applies. Missing/disappearing attempts remain recovery-only and are retained
conservatively. Pause or unavailable/throwing readiness never admits fresh work.

This bounds saved payout interface calls, not total worker CPU, memory, reads or
signing work. All tasks are still found in the whole ledger. Schedule enumeration,
expiry recovery, fresh cycle commitments and per-schedule fresh pages have their
own existing behavior. The live 1,000-holder admission limit remains unchanged.
No production worker or signer has been enabled or deployed.

Node 24 required inventory:

```text
node scripts/security-tests.mjs --inventory config/reward-recovery-page-tests.json
```

90/90 pass, zero failure/skip/TODO: 11 recovery cases plus the affected 79 holder
selection and payout cases using the same public reviewed artifact inputs. The
same controlled 65-attempt case fails against the previous recovery function
(65 calls instead of 32). Restart, two-store fairness, selected IDs, cached no-write,
failed cursor persistence, corrupt/duplicate state, disappeared original attempts
and actual paused/throwing scheduler behavior are covered.

The measurement fixture has two injected 1,001-leaf manifests and **marker-only**
saved attempts. It measures full original manifest proof validation inside the
actual store lock, transaction elapsed time, JSON bytes written, recovery calls
and process peak RSS. It does not model full production signed-wire/proof payload
sizes or authenticate 2,002 financial receipts. Byte measurement adds separately
reported serialization overhead. Lock-mutator time excludes that instrumentation;
transaction elapsed also includes queue/read/serialize/fsync/rename/unlock work.
No network call or chain transaction is sent.

The observed 1.89 MB ledger still incurs about 62.47 MB of whole-ledger writes
while 32 unresolved attempts reconcile. This exposes an outstanding storage cost;
paging alone does not solve it. Reducing redundant writes while preserving exact
proof-before-status durability is the next storage assessment. Independent
corrected-source review, realistic financial throughput/expiry, original archives,
live delivery, operational custody and the final funding packet remain open.
Contract971399ff/3f8a and the reviewed Loader prefix are unchanged.
