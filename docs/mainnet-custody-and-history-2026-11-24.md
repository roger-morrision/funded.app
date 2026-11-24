# Mainnet custody and eligibility preparation

The owner accepts backups on the same live server. Backup independence is not a
launch blocker under that decision. The database restore checks remain valid;
this acceptance does not turn a database dump into a financial signing journal.

## Operational custody

`prepareTokenConversionRuntime` now accepts an explicit
`fileCustody: { keyFile: '/run/custody/secret-key.json' }` for an operator or
price-attestation signing role. It derives the public identity and opaque custody
reference from the reviewed policy and runtime specification. It cannot be
combined with another custody resolver or used by the controller/recovery role.

The resolver is Linux-only. The key must be a canonical, nonsymlinked, regular
file with one link, owned by the runtime UID and mode `0400`. It validates the
64-byte key against the selected public identity. Loading is lazy, after the
existing release, deployed-program, policy, authorization and durable-attempt
checks. A failed load stays failed until a new runtime is prepared. Server close
or explicit `disposeCustody()` clears the retained key buffer.

The resolver signs only the exact unsigned version-0 conversion message for its
role and pinned program. Full transaction and financial-policy review remains in
the existing signing backend; file possession does not bypass it. Unit tests use
synthetic keys and transactions. The integration test verifies startup and a
rejected request without a key present, then a single settled request and replay
without duplicate submission.

On the approved server, the two operational roles use different UIDs (10001 and
10002), individual read-only key mounts, read-only container filesystems, no
capabilities and no privilege escalation. The inspection containers have no
network and exit after validating identity. Their image contains code only.
The payer, administrator, program and guardian keys remain local. This provides
role separation, not independent administration from the Docker host owner.

Run the installed offline check on that host with:

```sh
docker compose -f /opt/richpad/program-mainnet-preparation/custody-20261124/compose.json --profile inspect run --rm --no-deps operator
docker compose -f /opt/richpad/program-mainnet-preparation/custody-20261124/compose.json --profile inspect run --rm --no-deps price-attestation
```

These commands create no signatures or transactions. Production signing workers
are not started by inspection. The finalized deployed release, reviewed policy,
authentication and coherent financial journals are still required by runtime
admission. Do not manufacture empty journals to pass recovery checks or regard
the inspection image as an approved application release.

## Historical eligibility

The missing original bank belongs to old Devnet captures. The existing
`fresh-isolated-mainnet` deployment plan excludes Devnet financial state and
Devnet signers. Old captures and payment evidence remain retained, with their
original verification limits; no unpaid entitlement is silently marked paid.

Mainnet community preparation now refuses startup without a durable original
snapshot archive. Fresh preparation saves the complete captured inputs before
publishing the ledger record; restart verification replays those inputs offline.
Tests verify that Devnet records are rejected on Mainnet and that a missing
original archive cannot be replaced with current balances. These are mocked
bank tests, not a completed live Mainnet payout acceptance run.

The original old Devnet eligibility bank has **not been recovered**. Current
balances and recomputed Merkle roots cannot establish its completeness. It
remains unverified historical evidence, outside the fresh Mainnet state. If
eligibility for those exact historical drops must be certified, an authentic
original bank or replay archive is still necessary.

## Release boundary

These changes complete the file-custody implementation and prevent new Mainnet
eligibility records from repeating the archive gap. They do not deploy the ExUNA
program, create an independent review, authorize a spending budget or establish
live financial acceptance. Existing Mainnet write guards remain in place.

See [the verification record](evidence/mainnet-custody-history-2026-11-24.json)
and [the infrastructure inventory](../config/mainnet-infrastructure-preparation.json).
