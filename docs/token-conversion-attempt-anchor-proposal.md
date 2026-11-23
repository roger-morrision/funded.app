# Conversion attempt anchor: release dependency

Status: design proposal. No production anchor, signer admission, transaction, or
Mainnet deployment is authorized by this document.

## Why the three journals are insufficient

The controller, operator, and price-attestation journals are individually
validated and compared at resume. This catches a missing file, a different
context, a single-role rollback, and a controller rollback that loses a role's
durable signature. It cannot distinguish three intact files restored together
to the same older point from a system that never prepared the lost attempt.
An isolated synthetic test on source `7b18102b` signed and attempted one send,
restored all three files to their pre-attempt bytes, and observed that resume
admitted recovery-only with zero saved attempts. The test did not send a real
transaction. The single-controller rollback regression already passes on this
source; this proposal does not reopen it.

The current production plan has `freshInfrastructure.databaseReference` and
`freshInfrastructure.backupReference` set to `null`. The existing nonprogram
Mainnet service and Devnet database are not approved conversion anchor stores.
Placing a fourth file or table in the same rollback domain as the three
journals would not establish a no-loss boundary.

## Smallest durable boundary

Provision a separate, access-controlled, append-only attempt anchor whose
storage and retained backup are outside the rollback domain of all three
journals. A dedicated PostgreSQL database is one possible implementation only
if its WAL, backup, restore and administrative controls meet that separation.
An object store with immutable versions is another possible implementation.
Neither backend is selected by the present source or release plan.

The anchor API needs a durable, idempotent append keyed by the exact reviewed
release context and message hash, a monotonic sequence/high-water mark, and a
consistent read of every entry at or below that mark. Entries must retain:

* the genesis, program ID, effective ProgramData hash, signer-policy hash, and
  exact controller/operator/price public identities;
* the canonical unsigned message bytes or their content-addressed retained
  object, its hash, conversion nonce, vault and receipt addresses, input amount,
  minimum output, and immutable review identity;
* each role's validated signature when available, then the complete signed
  wire and transaction signature before the first broadcast;
* broadcast intent, finalized exact transaction/proof or finalized absence,
  and the state transition that discharged the reservation.

The anchor is an attempt ledger, not an authorization to widen the mint, pool,
amount, price, signer, or retry policy. A caller-supplied evidence hash or an
opaque reference string does not prove that an anchor exists or is independent.

## Required ordering and failure behavior

1. The controller persists its reviewed reservation and signing marker in its
   journal, then durably appends the immutable prepared attempt to the anchor.
   Neither role may sign until the anchor confirms that exact entry. If either
   write is uncertain, leave the attempt unresolved; do not prepare a new hash.
2. Each role performs its own current review, writes its signing marker and
   signature to its role journal, and durably appends that exact signature to
   the anchor before returning it. A crash after a signature but before the
   anchor acknowledgment is unknown and must not trigger another signature.
3. The controller validates both signatures on identical message bytes, saves
   the full signed wire in its journal, and appends it to the anchor. It records
   broadcast intent in both places before its one send with `maxRetries: 0`.
   Failure or an unacknowledged write at either boundary suppresses a send.
4. A finalized receipt and transaction-local balance proof, or the existing
   authenticated expiry and absence proof, is appended to the anchor before
   an attempt is treated as discharged. Unknown attempts remain retained.

These two stores cannot commit atomically. The safe rule is that any disagreement,
unavailable anchor, stale high-water mark, partial restore, corrupt entry,
unexpected sequence, or uncertain post-publication result stops **fresh**
signing. Saved proof may be reconciled read-only against the exact transaction,
program bytes, custody and receipt. No restart may infer that a missing entry
authorizes a new signature or broadcast.

On startup, read and verify the independent anchor first, then all three role
journals under a quiesced signing window. Compare every anchored attempt and
signed wire with the journal set. A role journal may be ahead during an
interrupted append; this is an unresolved state to reconcile, not a reason to
discard the anchor. A coherent three-file rollback must be detected because
the anchor retains a higher sequence or a missing message hash. Restore the
original signed bytes and proofs from the retained anchor/backup when possible;
otherwise require reviewed manual reconciliation before fresh work.

## Inputs required before implementing a production adapter

* An approved fresh Mainnet anchor storage reference, separate failure and
  administration domain, service authentication, retention and backup policy.
* A reviewed no-loss restore process proving that an older three-journal backup
  cannot also roll back the anchor; a saved high-water mark and content hashes
  must survive a fresh process and volume restore.
* Exact runtime resolver ownership, allowed instructions, access limits and
  recovery authority for controller and each independent signer role. The
  current public identities alone do not establish independent custody.
* A costed deployment/operation inventory for that backend and its backups,
  plus an exact release configuration and independent acceptance plan.

Once those inputs exist, implement the adapter behind an explicit production
reference and test crashes at every write, signature, send and restore boundary;
also test two controllers and mismatched role snapshots. Until then keep the
existing recovery-only/no-activation behavior. Do not use the current Devnet
PostgreSQL instance or the existing nonprogram Mainnet database as an implicit
production anchor.
