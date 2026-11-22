# Historical committed payout namespace

FQA-MN-005, application source slice. A planned operator rotation must preserve
already committed entitlements in the original vault/cycle namespace. The current
operator authorizes payouts; it does not become the seed for historical custody.

The nine SOL, classic USDC and Token-2022 address/owner regression bodies fail
against exact `1e516416` chain source with only fixture imports redirected. The
old implementation tries successor initialization or cannot find the saved cycle
and paid receipt. The corrected required inventory passes 23/23 on Node 24.22.3,
with zero failures, skips or TODOs. Removing the current public review ELF fails
closed with zero required passes.

`readCommittedRewardContext` starts from the saved cycle and reads its owned vault,
reserve and current router in a finalized context at least as new as the first
cycle read. It verifies immutable manifest fields, original authority/mint seeds,
bumps, asset, liability and current operator. Changed plans during awaited reads
are rejected. Only the immutable tuple and leaf count are copied; resolving each
recipient does not clone or enumerate the entire cohort.

`ensureCycle`, inspection and payout preparation reuse this authenticated original
namespace. A modern saved commitment does not initialize successor accounts or
count residual historical custody as successor funding. A fresh/current-operator
commitment still binds the caller's local plan after successful checks, allowing
the scheduler's immediate payout step to use it. Current-operator legacy migration
is preserved; an outgoing authority's unreserved legacy cycle stays unresolved
rather than being silently migrated. Closed commitments and missing known cycle
bindings cannot authorize new payouts.

The fixture exercises the actual scheduler, locked store, SDK instruction building,
in-memory transaction signatures, account parsers and Merkle producer. It emulates
bank/RPC/finality: a prior 100-unit receipt remains unchanged, the remaining 200
units debit original custody once, and 41 units of unrelated liability remain.
It rejects foreign/malformed/stale account bindings and altered intents. These
are **synthetic local acceptance targets**, not compiled-program execution, real
Devnet delivery or Mainnet financial acceptance. The synthetic Devnet bank uses
the public Mainnet ELF as a readiness input; it does not establish feature-profile
compatibility or new runtime admission.

Run with Node 24 and the existing public offline capture, historical proof ELF and
current review ELF inputs documented in the production packet:

```text
node scripts/security-tests.mjs --inventory config/reward-historical-payout-tests.json
```

The complete `finalizedSend`, readiness and durable expiry functions are unchanged
from independently accepted `1e516416`; their source hashes are recorded in the
evidence report. Contract runtime is unchanged from `971399ff`, so the accepted
`3f8a…4e50` ELF and 1,236-message Loader prefix are reused. Mainnet admission,
allowlists, entitlements, reserve, limits and financial policies are unchanged.

Independent exact-source review is requested. Durable payout-attempt transport and
exact finalized attribution remain separate work; this namespace correction does
not claim to solve unknown payout replacement. Authenticated archival account
banks, live complete 28-leaf delivery, holder scheduling above the current cap,
production operational custody and the final costed release packet remain open.
Receipt cleanup is Devnet-only and is excluded from Mainnet release acceptance.
