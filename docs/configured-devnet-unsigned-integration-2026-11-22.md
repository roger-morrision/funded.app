# FQA-MN-003 unsigned configured-program integration

This source slice connects the actual instruction builder, full price reviewer,
durable reservation journal and finalized proof parser for the isolated configured
Devnet program. It grants no signing or runtime admission. Financial accounts,
market quote, simulation and finalized transaction responses are deterministic
fixtures, not on-chain payment evidence.

## Frozen public context

- Program: `9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf`.
- Genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- ProgramData: `4ej89f84gD5MD9uoyUWLDWXqAw68yByBwJcyYSiTecf8`.
- Full ProgramData SHA-256: `bbf6b99857a9464c23d000caf7fa5cb5f19af7b2ce8ff402c2e9c37c8d68f688`.
- ELF: 1,204,336 bytes, SHA-256 `7b4b6bab3605135fb251894ca558f425f8bdc4c42e0de46ebfb00e135247c25f`.
- Contract source: `e5b3fd479c616540882c43d53afd29f7766d296c`, source tree
  `dd2f57ffe841adaca9b2e033950633247f64c7ac` (same tree as this branch's base).
- Features: `devnet-v3-program,configurable-rich-assets`.
- Contract owner reproduced these ELF bytes from a clean archive with locked
  dependencies, Agave 4.1.2/platform-tools v1.54/SBF v0/opt=z/strip=true.
  App independently matched retained ELF and finalized ProgramData/config/history
  bytes at slot 525102201. Owner rebuild and App account verification are distinct.

`config/configured-devnet-interface.json` pins these facts. Its canonical context
hash also binds the offline scope. Both revision 1 and revision 2 use authentic
retained configuration/history accounts. Fixture financial accounts are synthetic.

## Changed behavior and boundaries

The explicit `configuredDevnet` function argument selects the 72-byte protected or
130-byte agency ABI and appends the LE u64 asset revision and active-config PDA.
Configured Devnet retains its read-only router meta. Mainnet guard semantics are
unchanged. Current asset revision controls new review; immutable history controls
old finalized receipt parsing after rotation.

The journal binds reservations to the exact context and asset revision. Restart
and same-message retry preserve stored bytes. Old or different-context journals
require explicit migration. Unknown reservations remain charged; a replacement
requires finalized blockhash expiry and finalized absent-receipt evidence on the
same context. Missing archival evidence cannot release a reservation.

The HTTP signer, launcher, environment admission, policy limits, production
manifest, signing keys and live deployments are unchanged. An HTTP request field
cannot select this offline argument. Tests prohibit fetch/broadcast and retain
zeroed transaction signatures.

## Reproduction and results

Use supported Node 24.22.3 from this checkout. Set these two public-artifact inputs
to local retained copies (neither file is a wallet):

```powershell
$env:FUNDED_OFFLINE_ROUTER_ARTIFACT='C:/Data/DevApps/funded.app/.secrets/mainnet-readiness-artifacts/20261122/configured-devnet.so'
$env:FUNDED_OFFLINE_CONTEXT_SNAPSHOT='C:/Data/DevApps/funded.app/data/qa-evidence/mainnet-production-packet-20261122/configured-devnet-accounts.json'
node scripts/security-tests.mjs --inventory config/configured-devnet-unsigned-tests.json
```

The fail-closed runner is byte-identical to the independently accepted App runner
at `45e0cc9a8b8f0ba0c1c421de8c325e1b55303b05`. The explicit inventory requires
20 named tests: 20 passed, zero failed/skipped/TODO. Removing the ELF prerequisite
exits 1, with zero required cases passed; it cannot turn missing coverage green.

Both protected revisions traverse the actual builder/reviewer/journal/proof path.
Agency coverage verifies wire encoding and account metas only. Negatives cover
wrong genesis, program/context/ProgramData, stale revision, wrong config/meta,
nonzero signatures, weak output protection, receipt replay, missing proof/wrong
vault delta, journal restart/migration and unknown-attempt reconciliation.

Existing network/release/asset regressions: 12 passed, zero failed/skipped/TODO.
Source syntax and maintained-source budgets passed. The fixture exporter also
passed a separate syntax check. No frontend or deployment check is claimed.

`node scripts/export-configured-devnet-unsigned.mjs output.json` exports four
public unsigned fixtures, two asset revisions by two policy wire variants, with
message hashes, lookup-table addresses, account metas and zero signatures.

Evidence root: `data/qa-evidence/mainnet-production-packet-20261122/` in the shared
main checkout: `unsigned-integration-result.json`, `missing-artifact-result.json`,
`source-and-regression-results.json`, `unsigned-fixtures.json`,
`unsigned-source-evidence.json`, retained public context and raw stdout/stderr.

## Remaining production work

This isolated source slice is ready for independent source review. It does not
integrate the live app, configure a signer allowlist, close a landed reservation
for subsequent operating cycles, migrate old journals, or supply authenticated
historical ingestion. Those operational paths need exact reviewed production
context and separate acceptance. No production signature or financial execution
is authorized by this harness. Mainnet activation, complete 28-leaf delivery,
paired-asset financial acceptance and holder-scale readiness remain open.
