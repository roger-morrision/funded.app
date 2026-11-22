# Prepared payout payload measurements

MN001 now has a repeatable offline input generator and filesystem benchmark for
complete signed **prepared attempts**, replacing the marker-only dataset for this
measurement slice. Existing admission remains 1,000; 1,001 is an injected local
test bound. No runtime code, admission, signing policy or financial limits change.

`signedCapacityCohort` uses the existing actual chain and payout journal to build
and sign each leaf in memory. Each asset cohort has its own cycle ID/PDA and a
complete global manifest. Owned synthetic cycle/root/count/total and reserve
bytes agree with that manifest. Each distinct transaction passes the existing
canonical message/signature/intent/snapshot/accounting validator. The generator
does not duplicate one small-cohort wire across unrelated recipients. Shared
account addresses across asset banks retain identical bytes. No private keys
are written. Transport and all financial/finality RPC facts are mocked; no
transaction lands and there is no finalized payment proof.

Generation uses a serial in-memory staging store, explicitly outside the target
filesystem measurement. The benchmark publishes the complete rows into the real
locked/fsynced reward store, selects a fresh page with full global proof
validation, then recovers at most 32 saved attempts through the actual chain and
journal with unavailable finalized transactions. It reopens the real store and
checks every original attempt is unchanged, payments remain empty and recovery
requested no new blockhash/signature/send. Method counts describe mocked RPC
interfaces, not provider traffic or production transaction throughput.

Run with the same public capture and current reviewed 3f8a ELF inputs used by the
accepted payout tests (plus their retained public predecessor ELF dependency):

```text
node --test tests/readiness/reward-capacity.test.mjs
node --max-old-space-size=256 scripts/measure-reward-signed-capacity.mjs --count=33 --assets=SOL,USDC
node --max-old-space-size=256 scripts/measure-reward-signed-capacity.mjs --count=1001 --assets=SOL,USDC
```

The five focused tests cover SOL, classic SPL and minimal Token-2022 account
geometry with actual per-leaf signatures, mismatched-leaf/snapshot rejection,
filesystem restart/unknown preservation/no new action, distinct cycle namespaces,
compatible shared bank records and declared input bounds. Token-2022 fixtures
are not extension-specific compiled transfer acceptance. These use the existing
Devnet receipt-mode transaction geometry; they do not admit a Mainnet program or
establish production guard/price/worker integration.

The measurement prints its exact count, assets, proof depths, roots, unique
signed-wire counts, ledger bytes, actual inode replacements, candidate bytes,
mocked method calls, elapsed stages and peak process RSS. Transaction elapsed
includes queue/read/parse/serialize/fsync/rename/unlock and byte-count observer
overhead. Mutator time is only a subset inside the lock. Do not add those times
again. Stat observers add I/O. RSS includes construction, retained synthetic banks
and manifests, public ELF dependencies and the filesystem workload.

A 256 MiB V8 old-space flag is **not** an enforced 512 MiB process/container
limit. Report the actual V8 heap limit and peak RSS separately. This standalone
Windows benchmark has no full web server, indexer, other workers, production
background load, CPU limit or container cgroup. Passing it cannot establish
headroom under the intended 512 MiB app overlay. Complete verified-proof payloads,
mixed worker/expiry/capture work, Linux power-loss/backup restore and current
program live financial delivery remain separate open acceptance criteria. The
original missing Nov19 account bank and live 28-recipient criterion remain open.

On the owner's Windows/Node 24.22.3 run, two SOL/USDC cohorts measured:

| Leaves per cohort | Ledger bytes | Fresh selection ms | 32 unknown recoveries ms | Peak RSS KiB |
| --- | --- | --- | --- | --- |
| 33 | 208,285 | 10.35 | 376.76 | 136,100 |
| 1,001 | 7,194,872 | 116.34 | 2,580.69 | 394,560 |

The larger input has 2,002 unique signed messages, proof depths 6/9/10 and
maximum wires 713 bytes SOL / 887 bytes USDC. Recovery made 33 actual store
transactions and serialized 237,442,549 candidate bytes, with two ledger
replacements writing 14,390,357 bytes. Each of genesis/status/transaction methods
was called 32 times on mocked objects; no new blockhash or send occurred during
recovery. The V8-reported heap limit was 469,762,048 bytes despite the 256 MiB
old-space flag. These are single local observations, not percentile/SLA results
or an independently accepted production capacity threshold. The larger record
confirms O(N) reads and serialization persist after no-op publication reduction.

The first retained draft used separate synthetic asset banks at the same cycle
address. It was useful only for development and is superseded by distinct cycle
IDs plus an explicit shared-account consistency test. Use the final source-pinned
report, not that draft, for capacity observations. No chain cost or funding
request follows from filesystem or mocked RPC measurements.
