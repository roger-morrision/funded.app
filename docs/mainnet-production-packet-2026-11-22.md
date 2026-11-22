# Mainnet production release preparation

Status: **NO-GO; preparation only**. Human execution intent exists. The costed
proposal must be approved before new spending; no transaction has been signed,
submitted or deployed by this work. This document is the App-owned release packet,
linked to the existing FQA-MN-001 through FQA-MN-006 matrix, not another backlog.

## Current public identity tuple

| Role | Public address / identity | Status |
| --- | --- | --- |
| Mainnet genesis | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` | Independently read |
| Dedicated program | `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ` | Human-authorized local custody, undeployed |
| ProgramData PDA | `ETH5QpSQrKAqS1y2RDntJzXeTU9D79u1gz8hCUY4zsQT` | Derived; absent at quoted slot |
| Deployment payer only | `E9tQpKSi29HczaYdJKbiPLf2uhYEbNhq19muExsRdmgL` | Local custody; zero finalized balance |
| Fresh admin / upgrade | `5ThgFz4yFPX6fQ8mdaPjtKXeYYA6RwEMjkC2vaPMA6oi` | Local custody; zero finalized balance |
| Selected primary mint | `7R4MP6VX7n3RMNhL9zsk5Zu5ibZvwq8npUYnRq7epump` | Token-2022, six decimals, Singularity |
| Primary SOL pool | `58XqWPXDGp3GfU9DAFxs8C1GJwTLdHdQhJRofAF5yWTV` | Canonical PumpSwap, funded vaults, flags zero |
| Paired USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Exact-input base asset for conversion |
| Paired SOL pool | `Gf7sXMoP8iRw4iiXmJ1nq4vxcRycbGXy5RL8a8LnTd3v` | Reviewed sell orientation; integration pending |

The new admin supersedes ER7 only for this unreleased fresh plan. No existing
on-chain authority is changed; ER7's money is not a new wallet's balance. Manual
Phantom signing is superseded. Private keys and sensitive custody references stay
with the existing local custody owner and are never included in this packet.

App's finalized primary-market observation at slot 472581177 independently checks
mint/curve/pool owners, six decimals, revoked mint/freeze authorities, only
MetadataPointer/TokenMetadata extensions, complete empty curve, both vault mints,
pool ownership and positive balances. Metadata decodes to Singularity. Reserves
are time-varying evidence, not guaranteed execution liquidity. The existing route
requires **zero new token launch, pool creation or LP principal**.

## Exact artifacts and tested App slices

The current pair-enabled Contract candidate is source
`971399ff4e2ebdeca76a3e16a80273db38a8bfa0`, ELF **1,110,424 bytes**, SHA-256
`3f8aaffc8b308df74cafe7fff22ad37e0ee2a33e28f747468804c36c66024e50`.
Its build uses `mainnet-v3-program`, explicit ExUNA program ID, and explicit
`USDC:Gf7` conversion binding. App independently hashes the retained public ELF.
E2E independently accepted the preceding 8f6 exact-transfer custody fix and the
current 3f8 historical receipt-expiry correction and deployment prefix. App
historical address construction and full integrated/live acceptance remain
pending. Superseded 8f6/e55, the smaller f284/empty-conversion
candidate and 3qb public fixture are excluded
from full-feature release. An admin-only intent change does not alter these
compile-time inputs; do not fabricate a needless binary change.

Pinned build provenance: locked canonical LF Cargo.lock SHA-256
`d09534a70f3c4f4fa3d70297aa2b8f9b8f3cb38ecc4ee6e62bfd264412f35b33`,
Agave 4.1.2/platform-tools v1.54/SBF v0/opt=z/strip=true. Contract owns exact
source-to-bytes reproduction; E2E owns independent rebuild/compiled acceptance.
Full deployed ProgramData hash is **unset until a finalized deployment exists**;
the deploy-slot header cannot be supplied as a predeployment fact.

App source `a68cf7d12c611d58dff7d1198f5e5c6da4b67aff` passes the 20-case
configured-Devnet unsigned builder/reviewer/reservation/proof harness, independently
rerun by E2E. Financial RPC, quote and simulation are mocked. Twelve existing
network/asset guards pass. No live configured-program admission follows.

App composition `b61a483bb76f08bc84be5150cd9f77363094b8a9` includes the accepted
opening/payment recovery and E2E deadline correction. Twenty focused cases pass;
exact contributor runtime/test blobs match. Saved attempts reconcile after expiry;
crossing the deadline during quotes/blockhash reads cannot authorize a new signing
or rebroadcast. This does not prove authenticated archive or live 28-leaf delivery.

The captured USDC sell builder/decoder requires the exact 57-byte router ABI,
23 Pump metas plus 16 fixed and two price metas, exact input/floor, canonical
custody and independently read fee membership. Ten focused cases pass across
categories 5/6/7 and rejection cases. Full independent reviewer, durable typed
reservation, keeper and finalized proof integration remain in progress. This
helper is not imported by a runtime worker/signing service and changes no pool map.
The next receipt slice passes 16 additional cases (26 total with builder coverage):
both Ed25519 signatures and frozen message, exact sell CPI/receipt/category,
USDC debit, SOL credit excluding WSOL prefund and vault rent top-up, and closure.
An actual finalized RPC adapter requires the reviewed full program context and
matching finalized status/slot; the committed incomplete release rejects before
RPC. Positive adapter tests use explicitly synthetic ProgramData/review/status
fixtures. These are not independent production review or chain evidence.

## Current costs: quote inputs, not a funding request

Current Contract quote at finalized slot **472592348**, tied to 3f8 above;
independent E2E accepted the exact unsigned prefix. These are retained quote
inputs, not current funding instructions; refresh actual balances/fees before
execution.

| Item | Lamports | Accounting |
| --- | ---: | --- |
| Program + exact-size ProgramData | 5,642,665,880 | Locked rent, not a transaction fee |
| Upload buffer | 5,641,792,120 | Temporary/recycled deposit, not a second permanent cost |
| 1,236 unsigned deployment-prefix messages / 1,234 writes | 12,360,000 | Zero-priority base-fee projection, max wire 1,216 bytes |
| Initial router, 131 bytes | 1,315,720 | Future operator debit |
| RICH current + history, 177 bytes each | 3,098,800 | Direct new-admin rent debit |
| Price configuration, 40 bytes | 853,440 | Direct new-admin rent debit |
| Retained RICH-init message fee | 10,000 | E9 fee payer; E9 + 5Thg signatures |
| Protected operating reserve | 3,000,000,000 | Assigned ONCE to the operator, unavailable for routine spending |
| New token / pool / LP principal | 0 | Existing supported markets |

Prefix SHA-256:
`ac4e2708c14bbc7d341268bbe44d133ae0c54ce2e1789645f3b9dbf28d64dd5a`.
The Loader refunds the buffer to the SAME payer before ProgramData rent funding.
Native full-upload/finalization evidence and independent prefix decoding support
this ordering; no second full buffer rent is added to the permanent total.

Contract's corrected reserve allocation at `3657d4d934d8dff7fc6fdc0b280bd1415998b145`
is independently verified by E2E. The unchanged App source checks authority-payer
balance after maximum fees/rent: threshold 3 SOL + fee + maximum rent passes;
one lamport less rejects. E9 and price-attestor balances do not supply that reserve.

The **draft** 9.017665880 SOL envelope is allocated as E9 5.917665880 (rent plus
0.025 fee allowance and 0.25 contingency), admin 0.003952240 known direct rent,
operator 3.001315720 known reserve/router minimum, and 0.094732040 still unassigned
setup/canary. Actual operational expenses consume these allowances once; they
cannot consume the protected reserve. This is not a final top-up or funding
request: operational/price/guardian roles, balances and remaining messages are
unresolved. Source-only reserve corrections and the Devnet-only bitmap fix do
not change 3f8 bytes or require another unchanged Loader quote.

The final wallet table must replace every unknown with the real message inventory:

| Recipient | Current finalized balance | Required final calculation |
| --- | ---: | --- |
| E9 payer (full address above) | 0, slot 472590082Ã¢â‚¬â€œ83 | Upload/deploy fees and peak recycled rent, E9-paid setup/canary fees; approved contingency |
| 5Thg admin (full address above) | 0, same quote | 3,952,240 direct initial config rent plus any explicitly admin-paid fees/actions |
| Fresh operator | Identity not provisioned | 1,315,720 router rent, exact operational setup/ATA/ALT/canary costs, the single 3 SOL protected reserve plus expenses above it |
| Independent price signer | Identity not provisioned | Exact configuration/operating fee obligations, if any; do not assume it is a fee payer |
| ExUNA program identity | No direct top-up proposed | Rent is funded through reviewed payer instructions, not a blind transfer to this address |

For every real funding wallet, proposed top-up is `max(0, peak required balance -
fresh finalized balance)`. Final values need real upload/init/guard/ATA/ALT/canary
messages, reviewed limits and operational-role funding allocation. Fees vary; capture
quote time/slot, message hash, fee inputs and expiry, then re-quote before signing.
The removed aggregate deployment cap stays removed. The administrative daily cap
is a separate financial-policy decision and must not be silently selected.

The new independent quote/reviewer/durable journal integration is documented in
[the scoped source handoff](paired-sell-review-journal-2026-11-22.md). It passes
72 required local cases, with new review/journal fixtures binding current 3f8,
while all financial/RPC/review facts remain explicitly synthetic. Runtime signer
and worker admission remain disabled. Exact signed bytes must be durably saved
before any future broadcast; unknown attempts cannot be replaced blindly.

The [historical expiry source candidate](historical-reward-expiry-2026-11-22.md)
now binds original vault/cycle/reserve while the current operator signs. Twelve local
cases pass, including the adapter regression that fails on preceding App source.
This construction/equality slice is independently accepted at `2ca05602`.
The [durable expiry recovery candidate](reward-expiry-recovery-2026-11-22.md)
now persists signed messages before submission and attributes exact finalized
transactions before completion. Twenty-nine focused local cases pass, including
three original regressions on prior source. Independent review of this new
transport, historical payout/cleanup binding and live financial acceptance remain
open. Inactive state alone cannot close a saved attempt or permit a fresh signature.
The [scheduler reachability correction](expiry-scheduler-readiness.md) adds a
saved-attempt-only recovery pass before fresh readiness, enforced again in the
chain/journal layer. Its 43 focused local cases include selection and race guards;
independent acceptance of that delta remains pending.

## Custody, infrastructure and execution packet

E9 and ExUNA remain local deployment signers. 5Thg is the local admin/upgrade
signer for the reviewed one-shot deployment/configuration workflow, not an
unbounded hosted worker credential. The remaining concrete custody proposal is
two separate fresh roles: operational authority and independent price attestor.
Their public identities/backends, review limits, origin of market data and access
boundaries must be frozen before message construction. No Devnet reuse or relabeling
of payer/admin is allowed. Same-host service isolation alone is not independent
custody. A reviewed provisioning choice and administrative cap/canary proposal are
the remaining owner decisions; implementation and verification stay team-owned.

Existing secure RPC/SSH/provider references were inventoried by name without
printing their values. Empty isolated directories now exist under
`/opt/richpad/program-mainnet-preparation/{data,secrets,metadata,backups,releases}`.
Available capacity was approximately 98 GB disk / 4.8 GB memory. Existing running
service images/start times were unchanged. No service, DB, volume, paid resource,
credential or Devnet financial state was created/copied into production.

Final ordered signing manifest: buffer initialization/upload and authority handoff;
program deployment with ExUNA/E9/5Thg as required by actual message; finalized
loader/pointer/ELF/authority verification; operator router initialization; guardian
and approved cap; independent price configuration; RICH revision 1; exact other
required state/accounts; separately approved bounded canary. Each entry needs
decoded accounts/amounts/minimums, immutable message hash, signer roles, expected
post-state and expiry. All co-signatures must cover identical bytes. Unknown
submission outcomes reconcile before retries. No blind or early signature request.

Rollback/stop: preserve live Devnet 45e and existing non-program Mainnet d5;
deploy services serially only from independently accepted bytes. On identity,
accounting, reserve, pause, replay or health failure, stop writes and retain journals
and backups. Restore tested application/data backups with writes disabled;
an application rollback does not reverse finalized transactions. Buffer recovery
requires exact loader/account evidence; no automatic repeated deployment.

## Remaining critical work and evidence

| ID | Owner | Remaining acceptance |
| --- | --- | --- |
| MN-001 | App + Contract + E2E | Durable authenticated paging/scheduling beyond current 1,000 gate; realistic cohort timing/RSS/RPC/transaction evidence; preserve entitlements and bitmap bounds |
| MN-002 | App + E2E | Authenticated historical ingestion and complete 28-leaf delivery/restart/replay on the exact program; source corrections alone do not close it |
| MN-003 | App + Contract | Operational configured-program builder/reviewer/journal/proof/signer/worker integration, exact finalized context and historical migration |
| MN-004 | App + Contract + PM | Final reproducible reviewed artifact, signer identities/policy, ordered messages and wallet-specific funding proposal |
| MN-005 | Contract + App + E2E | Full paired sell/buyback/category accounting, receipt/debit/credit/closure/replay/unknown cases against final compiled bytes |
| MN-006 | App + independent QA | Clean source/CI/build identities, backup/restore, serialized rollout, bounded canary and live acceptance |

Shared App evidence: `data/qa-evidence/mainnet-production-packet-20261122/`.
Relevant files: `selected-mainnet-token*.json`, `production-cost-8f6b661e.json`,
`unsigned-production-rich-init-8f6b661e.json` (retained message review; old rent quote), `namespace-preparation.json`,
`unsigned-source-evidence.json`, `unsigned-fixtures.json`,
`integrated-community-deadline.stdout`, `usdc-sell-capture.json`, and
`usdc-sell-builder-result.json`, `token-sell-proof-result.json` and
`missing-proof-elf-result.json`. Original failed and superseded evidence is retained;
the earlier `current-production-cost-quote.json` belongs to historical e55.

Source references: [Solana transaction fees](https://solana.com/docs/core/fees),
[rent RPC](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption),
[Agave 4.1.2 Loader ordering](https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L259).
