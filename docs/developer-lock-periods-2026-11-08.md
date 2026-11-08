# Selectable developer token locks

Launch options: 6h, 12h (default), 24h and 48h beside the developer buy amount. The choice updates the review, invalidates earlier cost estimates, and is carried through the signed launch policy, recovery draft, mobile signing summary, escrow instruction and receipt verification. Zero developer buys create no escrow.

The merged router accepts the four exact durations through `initialize_and_lock_for`. Existing 12h instructions, account layouts and saved deadlines remain compatible. Release still pays only the saved beneficiary after the stored deadline; existing locks cannot be shortened.

## Verification

- JavaScript: 140 tests passed, including seven selectable-period checks.
- Compiled SBF programs: 10 LiteSVM checks passed for each of the Devnet and production-build-check variants (20 total). Coverage includes all four deadlines, early release, repeat initialization, double release, invalid durations, rollback and legacy escrow release.
- Both compiled artifacts match `config/contract-build-candidates.json`.
- Production frontend build, syntax/structure checks and CSS budgets passed.
- Browser: all four selections update help/review text; desktop and 390px mobile layout inspected, with a 44px-high selector and no horizontal overflow.
- A local capability check using the compiled candidate and a mocked ProgramData header/network returned all four periods. Existing/unrecognized program bytes continue to advertise only 12h.

## Deployment status

Devnet deployment was authorized after local verification. The release pins the tested Devnet executable (1,095,080 bytes; SHA-256 `26f0b678c881b28e01cd927f82ffb95cd377de2449f9e7507edad18725196485`). The cutover must verify finalized bytecode and the full ProgramData hash before activating the matching app. Unsupported deployments stop launch preparation before promotion burn or launch signing. Finalized chain and application acceptance evidence is recorded separately during deployment. The production artifact uses a public test identity and is not a Mainnet deployment artifact.
