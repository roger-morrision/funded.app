# Production conversion process and acceptance evidence

The private conversion path now has an executable entry point:

```sh
FUNDED_BUILD_ID=<reviewed-application-commit> node scripts/run-production-conversion-service.mjs check /run/funded/deployment.json /run/funded/bindings.json
FUNDED_BUILD_ID=<reviewed-application-commit> node scripts/run-production-conversion-service.mjs serve /run/funded/deployment.json /run/funded/bindings.json
```

Use the exact reviewed application image and Node 24 on Linux. `check` performs
finalized-chain admission and existing-journal validation, then exits without a
listener, signing or sending. It is not an offline schema check. `serve` repeats
admission before binding. The launcher does not load an environment file. Only
`FUNDED_BUILD_ID` selects the immutable build identity; role selection, credentials
and custody come from the two explicitly supplied files.

The deployment document contains `schemaVersion: 1`, `spec`, `policy`, `release`,
`listen` and `activation`. Use the existing reviewed bootstrap spec and price
policy from [runtime preparation](token-conversion-bootstrap.md). The release
must describe the actual deployed program, full ProgramData hash, ELF and source
revision, and approved price-policy hash. A candidate ELF hash alone cannot fill
these fields. The configured program-release manifest is still unadmitted.

`listen` must be exactly `{ "host": "127.0.0.1", "port": <explicit-port> }`.
Controller, operator and price-attestation are separate processes with distinct
ports. Put any cross-host or cross-container access behind a privately managed
TLS proxy. A loopback listener is not directly reachable from another container.
The production launcher uses the actual configured HTTPS origins; the test
adapter that rewrites them to local fixture ports is not used in production.

The binding document maps opaque references to canonical absolute files:

| Field | Required content |
| --- | --- |
| `schemaVersion` | `1` |
| `rpcFiles` | Only this role's RPC reference, mapped to one HTTPS endpoint file |
| `journalFiles` | All three distinct existing role journal references and paths |
| `authenticationFiles` | Controller: three distinct tokens; signer: its own token only |
| `custodyFile` | Signing operator/price role only; canonical Linux role-owned `0400` key file |

Authentication files contain one 64-character lowercase hexadecimal token.
RPC/auth reference files must be regular, canonical, single-link files of at
most 4096 bytes. Symlinks, path reuse, unexpected binding fields and controller
token reuse fail admission. The controller receives no custody path. Private
keys are read lazily only after a durable signing claim and fresh chain checks.
Do not copy credentials into a deployment JSON document, report or command line.

Recovery uses `spec.mode: "recovery-only"` and
`activation: { "status": "disabled" }`. It loads no signing key. Signing uses
`spec.mode: "signing"` and an activation record with `status: "approved"`, an
actual approval `reference`, `sourceRevision`, and the digest returned by
`productionConversionDigest({spec, policy, release, bindings, listen})`.
That record binds the exact selection; it is trusted operator input, not a
cryptographic proof that approval occurred. Owner acceptance of an AI review
method does not populate an operational activation record.

Journals must already exist. Normal startup cannot provision, truncate or reset
them. Use the separate reviewed first-provisioning procedure documented in the
bootstrap guide. All roles need access to validate the complete coherent set;
the locked file store also needs its lock-directory permissions. Keep that
storage under the approved custody/backup arrangement. Partial restores and
unknown signing attempts must be reconciled; restarting never rebroadcasts an
unknown send. SIGTERM/SIGINT drain the server and release retained file custody.
Repeated start, reopen after close and close during admission are rejected or
drained. The runtime preserves the private recovery identity accepted by
`selectMainnetTokenConversionRecovery`; no recovery timer starts automatically.

## Verification

`npm run test:production-integration` uses the explicit inventory in
`config/production-integration-tests.json`. Supply these public fixture files:

| Environment variable | SHA-256 |
| --- | --- |
| `FUNDED_OFFLINE_USDC_SELL_CAPTURE` | `e0a2d89f34bcf94421c225f2d5fe2ae2ab27c2c9fa4b162396a3eb38805e6aa3` |
| `FUNDED_OFFLINE_PRODUCTION_ELF` | `8f6b661e4318be921bc41db86d410d888afc62c851c1e56d60e129ce7bb75bbd` |
| `FUNDED_OFFLINE_REVIEW_ELF` | `b2e811357cf55dc6624a48b6f630eb6c32ae2c23f3bd6c271d6013c72db70b9c` |

Missing fixtures fail the suite. These integration tests require external public
artifacts and are not part of default GitHub CI. They exercise real HTTP roles,
Ed25519 signatures and persistent journals with mocked RPC/finality and RAM test
keys. Passing them is local acceptance, not live-chain financial acceptance.
The separate default security inventory includes the metadata regression cases.

Public metadata was uploaded with the existing credential-file setting and
verified again from a fresh process without credentials. The committed
[probe record](evidence/metadata-storage-probe-2026-11-24.json) can be rechecked:

```sh
npm run metadata:verify-storage -- verify docs/evidence/metadata-storage-probe-2026-11-24.json
```

The probe is disposable Devnet-labelled metadata: no token was created and no
transaction was signed. JSON and image byte equality are checked against pinned
hashes. Missing image hashes fail verification. A new publication saves its CIDs
before checking the public gateway, so a gateway outage can be retried with
`verify` without another upload. Existing output directories cannot be reused
for `publish`. Availability now is not a guarantee of permanent retention or
proof that a real launch's on-chain metadata points to these bytes.

## Release boundary

The owner explicitly selected and accepted Claude Desktop as the AI second
reviewer. Its actual scoped decision belongs in
`docs/reviews/production-candidate-claude-2026-11-24.md`; it is not a professional
human audit. Do not turn a conditional decision into unconditional approval.

This entry point covers private USDC-to-SOL conversion and recovery. Public
Mainnet launch, collection and payout activation remain guarded. All fourteen
financial acceptance cases still require their prescribed finalized transaction
and balance/account-delta evidence before full production acceptance. Local VM
tests, HTTP responses and mocked settlement do not satisfy that requirement.
`funded.vip` remains on Devnet; no Mainnet deployment or spend is performed by
these changes.
