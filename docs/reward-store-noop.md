# Exact-byte ledger persistence

FQA-MN-001 storage candidate. The existing store now retains the raw persisted
bytes read under its exclusive lock and compares them with the final serialized
UTF-8 JSON bytes. Only an existing byte-identical ledger skips content publication.
This is automatic; callers cannot bypass persistence with a return value or flag.
The queue, drain, lock and cleanup paths remain in force, including for no-ops.
Lock-file metadata operations still occur.

Missing-file bootstrap and version1-to2 migration still publish a ledger. Changed
signed attempts, proofs, statuses, amounts and heartbeat fields still serialize,
write an exclusive temporary file, fsync and rename before returning. Failed
mutators, serialization or publication cannot authorize the next action. Ordinary
read-only calls retain their return values and public-read cache behavior.

Raw-byte comparison matters: decoding UTF-8 before comparing can mistake malformed
persisted bytes for their replacement-character JSON. A draft string comparison
was rejected by a focused case. The final Buffer comparison preserves the previous
one-time UTF-8 normalization behavior, then permits only truly identical bytes.
Noncanonical whitespace is also normalized once, without skipping migration.

The dedicated checked entry point invokes the existing inventory validator
unconditionally and rejects absent required coverage:

```text
node scripts/check-reward-store-persistence.mjs
```

The Node 24 gate passes 288/288 with zero failure/skip/TODO. It covers 15 direct
persistence controls plus the affected holder/recovery,
payout, expiry, archive and conversion-journal inventories. Direct controls inspect
actual ledger inode/bytes, bootstrap, migration, changed-proof publication before
a simulated callback, falsey return values, serialization and physical rename
failure, competing stores, cache correctness, malformed data, offline byte-copy
reopen and drain behavior. A byte-copy unit reopen is not production financial
restore acceptance and cannot authorize retrying an uncertain transaction.

The controlled two-injected-1001-cohort benchmark uses the same body against the
previous and candidate stores, with only the store import redirected. It records
physical ledger replacements from actual file identities and bytes after each
transaction. Thirty-two unresolved recovery calls retain 33 transaction invocations
but reduce ledger replacements from 33 to 2. Serialized candidate bytes remain
62,470,800; physical ledger bytes fall to 3,786,064. These are disk writes, not
Solana transactions or fee savings. Most candidate bytes no longer need publication. The dataset has marker-only attempts,
not full signed-wire/proof payloads. Observer stat calls and JSON byte-count work
add measurement overhead. These are local observations, not a financial throughput
or live latency promise.

Whole-ledger discovery, parsing, comparison, serialization and memory remain O(N).
The snapshot bytes are retained during a transaction. The controlled isolated
case recorded peak RSS 244,488 KiB versus the baseline 174,688 KiB; the full gate
recorded 264,736 KiB. This change does not establish lower memory consumption or
production headroom. The repository resource overlay declares 512 MiB for the app,
which is not a measurement of a live or fully loaded production process. The store assumes its writers
cooperate with the existing lock. Process restart, unit failure and byte-copy checks
do not prove Linux power-loss durability, external backup restoration or complete
on-chain recovery. Existing directory-fsync/backup and realistic-scale gates remain
open. No schema, entitlement, receipt verification, signing/admission/cap or financial
policy was changed; live services and Contract9713/3f8/Loader quote are unchanged.
