# Durable single-recipient reward payouts

FQA-MN-005 application integration slice. Independent QA accepted its covered
45 cases at `969809a0`; the additional [recovery corrections](payout-recovery-corrections.md)
remain pending separate acceptance.
This extends the original-custody namespace correction accepted at `47ab8d95`.
It changes no production admission, signer allowlist, entitlement or deployment.

The existing scheduler store now reaches the single receipt-mode payout path.
Before broadcast, the locked/fsynced store saves the complete signed transaction,
signature, blockhash validity, immutable leaf/manifest intent, original namespace,
owned cycle/reserve snapshot and reviewed full ProgramData hash. A second process
that sees this attempt reconciles it and cannot request a fresh blockhash or send.
Disk-write rejection prevents broadcast. Unknown, failed, expired or insufficiently
attributed attempts remain reserved for review; automatic replacement is disabled.

Reconciliation verifies the actual Ed25519 signature and canonical instruction
geometry, finalized status/transaction slot and identical saved message. It uses
the existing uncached effective-program verifier: the pinned deployment must be
before the transaction and finalized program contexts at/after it. Exact native
or token transaction-local custody and recipient deltas, a newly created owned
receipt, immutable original cycle and compatible liability state are required.
State/receipt existence, an oldest signature, or a successful status alone cannot
complete a saved attempt. Intervening state that cannot be attributed stays pending.

For native self-payment, the recipient also pays the exact transaction fee and
new receipt rent. The proof requires those precise costs and no other native
movements; it does not silently exclude an existing supported recipient. Token
self-payments retain exact token accounting. Before broadcast, the authority's
balance must cover the single protected 3 SOL reserve plus quoted fees, receipt
rent and maximum destination ATA rent. Token-2022 rent includes required account
extensions and ATA immutable-owner storage. This is not a funding quote.

Saved-attempt-only recovery runs through actual `scheduler.execute` before false
or throwing fresh-work readiness. It respects selected IDs and does not call
preparation/signing/broadcast for absent or disappearing attempts. It preserves
the original uncertain marker when one disappears without an immutable intent
change; removed or replaced schedules cannot inherit its result. Completion is
persisted before the payment row can become paid. The normal fresh-work readiness
check remains mandatory. Mainnet direct single submission without a durable store
is rejected before signing.

The required Node 24 inventory is:

```text
node scripts/security-tests.mjs --inventory config/reward-payout-journal-tests.json
```

The original inventory contained 23 affected namespace cases and 22
transport/recovery cases: 45/45 passed. The current inventory adds the metadata,
native fee/rent and wrapped-native corrections, for 69/69 with zero failures,
skips or TODOs. The same first nine original new bodies fail on
the exact `47ab8d95` chain export with only import prefixes redirected. Missing
current review ELF fails closed with zero required passes. The affected expiry
inventory also passes 43/43 because the scheduler recovery entry point changed.

All financial bank/RPC/finality, balances and receipts in these tests are
**synthetic**. SDK signatures use deterministic in-memory unit keys only. Minimal
Token-2022 mint/address/owner fixtures establish routing and rent/accounting paths,
not extension-specific compiled transfer acceptance. No endpoint, wallet funding,
signing request, chain transaction or deployment is performed.

Scope limits remain explicit. Existing Devnet legacy receipt recovery, bitmap
and multi-recipient batching retain their separate paths; their unknown-attempt
durability is not claimed here. Old Mainnet paid state without a signed saved
attempt requires authenticated archival recovery rather than the legacy Devnet
reader. Production roles/custody, authenticated archive/live 28-leaf delivery,
holder scheduling above the existing cap and final release/funding acceptance
remain open. Contract source `971399ff`, reviewed ELF `3f8a…4e50` and the accepted
1,236-message Loader prefix are reused unchanged.
