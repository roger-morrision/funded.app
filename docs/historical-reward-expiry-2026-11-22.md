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

This addresses the construction/state delta candidate only. Existing expiry
transport still needs durable signed-attempt persistence and exact archived
transaction reconciliation before unknown submissions can be safely retried.
Status plus state reads do not close that remaining task. Historical payout and
receipt-cleanup paths also still derive current-authority addresses. Mainnet
admission remains disabled; retain old custody, entitlement and proof records.
Independent source review and parent MN003/MN005/full release gates remain open.
