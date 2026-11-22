# Mixed proof records and constrained scheduler components

MN001 extends the accepted a85a64a2 prepared-input baseline without changing any
server runtime, admission or financial policy. `mixedCapacityCohort` first uses
that existing generator for a coherent global manifest and distinct signed wire
per leaf. Every other leaf is then applied to a synthetic transaction-local bank.
The actual chain/journal verifies its exact message, signature, current pinned
program context, native fee/rent effects, token movements, owned receipt and
compatible liabilities before deriving and persisting a proof. The fixture does
not set a verified flag or manufacture a completion object directly.

These bank/finality facts are mocked. No SBF program runs in this measurement,
no chain transaction lands and no live financial acceptance follows. Ordinary
SOL, classic SPL USDC and minimal Token-2022 geometry have focused controls;
this adds no extension-specific or blanket asset support claim. An inconsistent
native fee fact remains unresolved under the actual proof parser.

The workload calls actual scheduler `captureDue`, `prepare`, selected-ID
`execute`, `status` and a concurrent financial snapshot projection. Capture is
one normalized synthetic indexer callback. With no available funded pool,
planning adds only the expected future indexing row. Execution uses existing
receipt-mode commitments and saved attempts, with zero new blockhash/send. Paid
metadata and all original signed attempts/proofs must survive; unknown attempts
cannot become paid. This deliberately uses selected-ID execution: automatic
Devnet batching, the HTTP server, expiry with actual pending work, raw RPC capture,
other service loops and full app/background load are not covered by it.

The public snapshot bundle includes a closed ledger plus synthetic account bytes,
balances and transaction metadata. It excludes signer objects, private keys and
endpoints. Files are exclusively written and fsynced; the checksum index is
published last. A separately retained index digest binds both files before read.
Reopening creates the bank from public facts and memory-only fixture identity;
attempting a new blockhash or send is an error. The second Linux process restores
the ledger and repeats component activity. Original payment metadata, receipts,
proofs and unknown identities must remain unchanged. A damaged bundle or wrong
index digest is rejected. This is controlled synthetic byte-copy restoration,
not an authenticated production backup or permission to retry a financial attempt.

The owner uses the existing local image with Node 24.22.3, image identity
`sha256:4c9df59dbdd43eb61953233561eecfd4946862f0983b9298fa5dfab1a597c30c`.
Its production entrypoint is overridden. No image is pulled. Networking is
disabled, root is read-only, capabilities are dropped and no-new-privileges is
set. Only the source-only archive, three public fixture inputs and a dedicated
public evidence output directory are mounted. No deployment secrets, wallets,
Docker socket or production data are mounted. All 159 non-root lock entries are
compared with the retained image before running; runtime source comes from the
hash-pinned archive, with dependencies reused from that image.

Actual resource settings are 0.75 CPU, 512 MiB memory, no swap and a 192 MiB
temporary filesystem. The measurement refuses `--require-cgroup` unless Linux
reports `cpu.max=75000 100000`, `memory.max=536870912` and `memory.swap.max=0`.
It records cgroup peak/current memory, OOM events and CPU throttling alongside
process RSS and V8 limits. Source extraction, fixture construction, retained
synthetic evidence and temporary files consume the same container budget.

Two injected 1,001-leaf SOL/USDC cohorts each contained 501 parser-verified
synthetic proofs and 500 prepared unknowns. Each retained 54,034 units of original
liability, including 41 unrelated units. Owner measurements under these limits:

| Process | Selected worker pass | Store transactions | Candidate bytes | Reported cgroup peak bytes | Peak RSS KiB |
| --- | --- | --- | --- | --- | --- |
| Construct mixed input, run components, export | 28.51 s | 98 | 835,453,170 | 257,908,736 | 285,220 |
| Fresh process, verify bundle, restore, run components | 24.89 s | 98 | 844,358,641 | 262,938,624 | 289,100 |

Both passes exercised 96 submit interfaces (saved recovery plus two bounded
single-receipt schedule pages), one normalized capture, status and financial
snapshot projection. Both reported submitted zero, no new nonce/send, no OOM
events and unchanged original attempts/proofs/paid metadata. The complete ledger
grew from 8,445,023 to 8,536,567 bytes on the first pass and to 8,627,270 after
restore, reflecting capture/worker cursor/pending-status data. The two temporary
Linux filesystems belonged to different containers; backup files were copied via
the dedicated host evidence directory and externally checksum-bound index.

V8 reported a 271,581,184-byte heap limit and 536,870,912-byte constrained memory.
CPU throttling counters advanced under the actual quota. RSS and cgroup accounting
cover different categories, including shared pages; do not compare these Windows
and Linux observations as a speedup or general headroom result. Repeated complete
ledger serialization still dominates candidate bytes. Timings include observer
costs and are single observations, not an SLA or live financial throughput.

Focused tests:

```text
node --test tests/readiness/reward-capacity-mixed.test.mjs
node scripts/measure-reward-mixed-capacity.mjs --count=1001 --require-cgroup --export=/outputs/bundle
node scripts/measure-reward-mixed-capacity.mjs --resume=/restore --bundle-sha=<retained-index-sha256> --require-cgroup
```

Six cases cover mixed proof derivation, actual parser rejection, metadata/unknown
preservation, component activity and checksum-bound public snapshot restore. The
source/input manifest and raw Docker outcomes are retained outside the ledger.
Candidate-byte observation adds serialization inside the lock. Transaction
elapsed aggregates overlapping queue waits, not wall time. Physical replacement
counts are not inferred from before/after file identities under concurrent work.
Linux tmpfs and a host bind-mounted public backup destination do not establish
production persistent-disk power-loss behavior or operational backup restoration.

Passing this bounded workload cannot clear MN001 or the release. Full normal
worker/app loads, realistic financial deadlines/provider limits, original bank
archive/live28, operational custody/runtime integration and the final funding
packet remain separate criteria. Admission stays 1,000; 1,001 cohorts are injected
fixtures only. Contract9713 / ExUNA3f8 / the accepted Loader prefix are reused.
