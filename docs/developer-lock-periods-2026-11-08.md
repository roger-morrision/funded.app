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

## Deployed and verified on Devnet

Accepted 2026-11-08T02:25:07.430Z. App revision `02325ff1f181189096ba496b4fe575c71c729a07`; all four release services healthy. Public API reports all four supported periods and the UI updates its help/review for each choice.

- Executable upgrade: [finalized transaction](https://explorer.solana.com/tx/443UXMYjAiQteJ8wWYjJRpSUxzaCGVRTgZPvVqnaZFSysgp876cNNU2G9M74VjdhnnFEdCwDX6dYd9nsAq5TLMoo?cluster=devnet).
- Full ProgramData hash: `d7de1417b9c8acb3d7a80193f86ba86f72e3afa2caff08fe34964be8f60dc199`.
- Legacy escrow executable remains unchanged. Upload buffer closed and its rent returned.
- Four ephemeral-wallet deposits each moved exactly 100,000,000 base units into the expected vault, saved the exact selected duration and rejected early release in simulation. Deadline release is VM-verified; these live fixtures have not reached their deadlines.

| Period | Locked at (UTC) | Unlocks at (UTC) | Receipt |
|---|---|---|---|
| 6h | 2026-11-08T02:22:39.000Z | 2026-11-08T08:22:39.000Z | [Finalized deposit](https://explorer.solana.com/tx/3KxX8YtmqBSMYQ9CrGxYCkVmyY1MrYKvJQwFrpGpMgCYgaoMBNm5KAnzqJYvMGeRB6FF7B9x28hqcCGVh2PYnKsu?cluster=devnet) |
| 12h | 2026-11-08T02:23:04.000Z | 2026-11-08T14:23:04.000Z | [Finalized deposit](https://explorer.solana.com/tx/5jWfnwKyZJYizwPz947pATABs5ouCjSp7KXk98FBH5LcyDxxikABKiEWSi3ggUV1vB1F3cE9jHdFrTMLQCmsWHVB?cluster=devnet) |
| 24h | 2026-11-08T02:23:29.000Z | 2026-11-09T02:23:29.000Z | [Finalized deposit](https://explorer.solana.com/tx/Kadd3o7QN1vdXbh6vPdAceUYvEMvhhhVGLmuDM6Wx5Ro1GxhUDrPbYLTk46r7jdmTZs2DPT1izhm68g6uzBLfkz?cluster=devnet) |
| 48h | 2026-11-08T02:23:54.000Z | 2026-11-10T02:23:54.000Z | [Finalized deposit](https://explorer.solana.com/tx/2BX2MTF3dyZNqvhE78PbBLgkKrREfcqy9ovme3U5qMYAuPXd2zk8hSeL3k1er1ufo3TGYzf2tCxK6VpKX7qZVMs8?cluster=devnet) |

QA note: the 48h fixture's RPC block time differed from its on-chain clock by one second. The receipt and escrow state were reconciled without a second deposit. The app verifies against Pump's on-chain event timestamp, not the RPC block-time estimate. Three test wallets returned unused SOL; the interrupted fourth retained 0.01970688 Devnet test SOL because its ephemeral key was not persisted. No Mainnet deployment or Mainnet spending occurred.
