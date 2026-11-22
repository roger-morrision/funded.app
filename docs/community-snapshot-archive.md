# Prospective community snapshot archives

FQA-MN-002 source candidate. This retains future, already-read finalized RPC
inputs so they can be verified after restart. It does **not** recover the missing
Nov19 account banks, perform a financial delivery or clear Mainnet readiness.

`prepareFresh` now passes the existing evidence callback when archive storage is
explicitly configured. Indexed and largest-account capture retain the actual
common mint-and-token-account batch context, full account bytes, public addresses,
owners, executable flags and lamports. Normalized balances are reconstructed from
those bytes and must cover the complete initialized mint supply with disabled mint
authority. Raw evidence copying is opt-in; capture without an evidence callback
retains its previous RPC behavior. Evidence capture adds one bounded signature
status lookup on the same provider and retains its actual slot/success/finality
reply, rather than manufacturing a confirmation field from a render or request.

The program-list fallback remains explicitly split: its mint was read without a
context and its account listing has a later context. Equal supply does not invent
a common mint slot. Normalized legacy capture is preserved; this path cannot
publish an exact-bank archive. The current indexed reader still limits its atomic
batch to 99 token accounts. This implementation does not solve the larger-holder
same-bank provider requirement or increase the holder cap.

The archive binds the expected cluster/genesis, program/authority scope, mint pair,
funding and requested migration references, reserved quantity, actual cutoff,
manifest root/snapshot hash, delivery mode and original deadline. Retained signed
migration message bytes must verify every required signature, fit the transaction
packet bound and match the requested transaction ID. The signed instruction and
returned metadata must identify the canonical initial pool creation. Legacy and
v0 messages with loaded addresses are covered. Finality, account-bank provenance
and loaded-address metadata still rely on the configured finalized RPC: signatures
and a content hash are **not consensus state or independent bank-finality proofs**.
The ProgramData value in this context is an expected pin, not a newly verified
deployment claim.

Publication uses canonical PublicKey/Buffer/BigInt/Map serialization, a SHA-256
content address, exclusive temporary file creation, file fsync and atomic hard-link
publication. Existing corrupt content is rejected rather than overwritten. The
directory is synced before publishing the ledger reference where supported;
Windows records directory fsync as unavailable when the platform refuses it.
File/header/hash/context validation precedes the ledger pointer. Read/restart
revalidates all raw inputs, parent-linked replay, supply, original snapshot and
rebuilt allocations/proofs/root/quantity/deadline, without current RPC balances.
Missing, damaged, differently scoped or incomplete evidence fails closed.

In archive mode the existing claim settings are checked before bank capture. The
callback flushes the full evidence/intent before the producer returns, so a later
preparation interruption leaves the captured bank file available without falsely
publishing a prepared ledger row. Returned snapshots cannot mutate that sealed
intent. Legacy capture keeps its previous settings-read ordering.

`FUNDED_COMMUNITY_SNAPSHOT_ARCHIVE_DIR` selects the storage namespace for the
existing service factory; the constructor also accepts the explicit archive
adapter. This configures data retention, not a new worker or Mainnet admission.
Use a fresh isolated ledger/volume for release preparation. Enabling strict archive
mode on an aggregate-only legacy ledger makes those records unavailable for
qualification; it never silently recaptures their historical balances. Existing
Devnet and non-program Mainnet services have not been configured or deployed here.

Default per-artifact storage bound is 32 MiB, with an explicit constructor maximum
of 128 MiB. Oversized evidence is rejected without trimming history or publishing
a ledger record. Archives are append-only; production capacity, backup/restore,
Linux power-loss durability and realistic cohort performance remain release work.
This local run proves process restart/file validation on Windows, not those gates.

Node 24 required inventory:

```text
node scripts/security-tests.mjs --inventory config/community-snapshot-archive-tests.json
```

53/53 cases pass, zero failure/skip/TODO: 24 new archive cases plus 29 affected
snapshot/opening/payment cases. The same three capture/qualification bodies fail
on the exact fe518 source closure with only imports redirected. Tests include both
atomic paths through actual prepare/write/restart, split fallback refusal, requested
ID mismatch even with a valid file hash, raw ownership/flags/authority/layout/supply,
missing history, filesystem failure, immutable manifest/deadline, byte budget and
unopened/expired claim rejection. RPC/bank state and reserve/program checks are
mocked; signatures use only deterministic in-memory unit keys. No network endpoint,
real wallet, deployment, spending, on-chain payment or historical recovery occurred.

Independent exact-source verification is requested. Contract `971399ff` / `3f8a`
and its Loader prefix remain unchanged. Previously accepted payout70/expiry43
evidence is reused by unchanged source identity. Authenticated original archives,
real current-program 28-leaf delivery, large-cohort scheduling, operational custody
and the final costed release remain open.
