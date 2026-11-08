# Mainnet preparation — 8 November 2026

**Status: preparation only; Mainnet remains NO-GO.** No Mainnet transaction, deployment, authority change or production wallet creation was performed.

## Implemented and checked

| Area | Result | Evidence boundary |
| --- | --- | --- |
| Production contract build | Dedicated `mainnet-v3-program` feature; explicit public identity required; conflicts with Devnet and historical QA recovery rejected | Local SBF build using a public test identity; not an independent audit or deployment artifact |
| Custody and community claims | Eight compiled-bytecode VM checks passed on each candidate (16 total), including 12-hour lock, fixed beneficiary, unsafe mint rejection, duplicate/ineligible/expired claims and reserve preservation | Local LiteSVM; does not cover every financial instruction or Mainnet compute budget |
| Metadata | Canonical `/api/token-metadata` endpoint with legacy Devnet alias; signatures bind the network; Mainnet requires durable content-addressed metadata | Boundary tests; real production Pinata credentials and content availability remain unverified |
| Router evidence | Selected network checked before account reads; Mainnet cannot inherit a Devnet evidence provider | Boundary tests; production program identity still needed |
| Backend staging protection | Mainnet mutations and RPC transaction submission blocked even when client trading flags are enabled; conflicting client/server networks rejected; WebSocket proxy allows read subscriptions only | Actual isolated API and WebSocket server tested; writes rejected and read subscriptions forwarded |
| Live Devnet promotion launch | 139 FUNDED burned before Pump creation; 30,000,000-token reserve and developer lock verified; server independently registered receipts | Real finalized Devnet transactions through the launch client and API; ephemeral QA signer, not Phantom UI automation |

Public transaction evidence is in [the Devnet acceptance record](evidence/mainnet-prep-devnet-launch-2026-11-08.json). Unused QA funds were returned. The developer purchase remains subject to its original 12-hour lock; the elapsed-time release behavior was tested in the VM, not by waiting 12 hours on Devnet.

Validation totals and remaining blockers are recorded in [the preparation report](evidence/mainnet-preparation-2026-11-08.json): 133 JavaScript checks, 16 compiled-bytecode VM checks, six rejected build configurations, successful app build, syntax and source-size checks. These are preparation results, not Mainnet acceptance evidence.

## Contract artifacts and runtime trust

The [candidate manifest](../config/contract-build-candidates.json) records the exact hashes and toolchain. Production-build testing uses `3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh`, a public fixture with no loaded deployment signer. **Do not deploy this test identity.** The final production ID changes the binary and requires a fresh build, hash, size/rent quote and review.

The rebuilt Devnet candidate also has a different binary hash. The app's existing deployed-program commitment in `server/agency-release.mjs` is deliberately retained. CI checks the new candidate against its separate manifest; it does not add the candidate to runtime trust or authorize an upgrade. The existing `verify-agency-binary.mjs` command continues to check the deployed commitment.

Build a future reviewed-identity candidate on Linux/WSL with the pinned toolchain:

```sh
export FUNDED_MAINNET_PROGRAM_ID=PUBLIC_PROGRAM_ADDRESS
export FUNDED_MAINNET_FUNDED_MINT=PUBLIC_MAINNET_FUNDED_MINT
export FUNDED_MAINNET_FUNDED_POOL=PUBLIC_MAINNET_FUNDED_POOL
export CARGO_BUILD_SBF=/path/to/agave-4.1.2/bin/cargo-build-sbf
bash scripts/build-mainnet-contract.sh /path/to/new-artifact-directory
```

This builds only; it does not load signers, send transactions or change Solana CLI configuration. It records source revision and working-tree status. A deployable review packet requires a clean committed revision. Compiler jobs default to two. Never interpret a successful build as production approval. Solana distinguishes the [program address and upgrade authority](https://solana.com/docs/programs/deploying); both must be selected explicitly.

## Still required

| Work | Current blocker / next input |
| --- | --- |
| Final contract artifact and custody review | Dedicated production program ID, upgrade authority and independent review tied to exact source and bytes |
| Production inventory | Mainnet FUNDED mint, fee recipient, deployment payer reference, domain, isolated RPC/database and metadata credential file references |
| Complete network port | Launch submission/registration, collection, payout workers, market indexing and claim reconciliation still contain Devnet-only paths; they remain closed pending implementation and verification |
| Full financial acceptance | Collection, all recipient categories, buyback execution, reconciliation and optimized-contract compute budgets need a current complete evidence run |
| Mainnet canary | Final artifact, verified inventory, exact funding/spend cap and a concrete canary/rollback plan; no canary has run |

The existing 5 SOL estimate concerns the earlier size-optimized program deployment only. It does not fund the complete app or cover hosting, liquidity, operating transactions and independent review. Requote the final reviewed binary before funding a deployment wallet.

Run `node scripts/mainnet-readiness-preflight.mjs` for the current no-go configuration report. Its `--online` mode only reads finalized Mainnet evidence after isolated configuration is complete. No flag in this preparation enables Mainnet writes.
