# Historical reward expiry: application address binding

FQA-MN-005 source correction, **local-only; not deployment or financial evidence**.
The accepted Contract fix `971399ff` is composed as App commit `f7f84978`.
Contract runtime source matches 971399ff; its accepted ExUNA ELF remains
`3f8aaffc8b308df74cafe7fff22ad37e0ee2a33e28f747468804c36c66024e50`
(1,110,424 bytes). No new binary or Loader quote is required.

Previously `expireCycle` derived vault/cycle from the current signer, selecting
a fresh namespace after rotation. The new original adapter regression fails on
unchanged ffa3 source with `Reward cycle is missing or has an unrecognized
layout`, before any mocked submission. Identical test passes after correction:
200 of 241 reserved units release, unrelated 41 remains, no custody moves.

The runtime now calls `readRewardExpiryContext` using the saved journal cycle
and immutable manifest. It authenticates finalized owned cycle/vault/reserve,
stored original authority/mint and PDA seeds/bumps, root/amount/asset/count/times,
canonical current router/operator, pause/grace and contextual read ordering.
Mainnet additionally requires the incomplete-by-default reviewed release and
uncached full ProgramData/ELF/authority verification. Missing saved state never
falls back to the successor's namespace. The unchanged five-account ABI uses
current operator signer, original vault/reserve/cycle, current canonical header.

After the existing finalized send, verification requires the exact flag change,
unchanged immutable bytes/paid totals, exact unpaid reserve decrement and unchanged
vault/cycle/reserve lamports and vault bytes. Authenticated inactive state is
idempotent with no additional send. The schedule retains original vault/authority
and no longer describes historical funds as automatically reusable by a successor.
No sweep, entitlement change or privileged fund-reuse path is introduced.

Run Node 24.22.3:

```text
node scripts/security-tests.mjs --inventory config/reward-expiry-context-tests.json
```

Use the same three hash-checked public capture/ELF environment inputs documented
in the paired review/journal handoff. Ten required cases pass, zero fail/skip/TODO.
Read-only Mainnet-context tests bind actual 3f8 bytes but use synthetic deployment,
review and financial account banks. The actual adapter signing case is explicitly
**mocked Devnet RPC**, deterministic in-memory test keys and an in-memory send
callback; it is not deployed-program or chain evidence. SOL/USDC, genesis/program,
manifest, owner/seeds, old signer, pause/grace, stale state and incorrect release/
custody deltas are covered. Four changed JS syntax checks and 1,405 source-size
checks pass. Original failing output is retained alongside the passing inventory.

This addresses construction/state delta only, independently accepted at 2ca05602.
The subsequent [recovery candidate](reward-expiry-recovery-2026-11-22.md) adds
durable signed-attempt persistence and exact transaction attribution; its separate
local tests do not close live financial acceptance or authorize unknown retries.
Historical payout/receipt-cleanup paths remain open. Mainnet admission remains
disabled; retain old custody, entitlement and proof records. Parent MN003/MN005
and full release gates remain open.

FQA-MN-005-EXPIRY-01 correction after Contract/E2E review: creation permits payout equal to
cutoff. App admission now uses `payoutAt >= cutoffAt`, preserving the separate
review-delay/grace checks. The equal-time regression fails on exact e04 helper
bytes under Node 24 (only its test import prefix redirected), then passes on the
corrected source; SOL and paired USDC both reject one second before grace, accept
exactly at and after grace, and reject reversed times before RPC. The updated inventory
passes 12/12, zero failure/skip/TODO. Contract bytes/quote and all other acceptance
scope remain unchanged. Original failure and correction evidence are retained in
`docs/evidence/historical-expiry-equality-correction-2026-11-22.json`.
