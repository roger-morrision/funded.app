# Devnet fee-router authority rotation — 2026-09-30

This record covers Solana Devnet only. Mainnet was not changed or verified.

- Program: `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`
- Program upgrade authority: `3NMjsHsau8uw598UKZqbKq8dhFjGMEYpdx5wU72Kfh1P` (separate app owner role)
- Legacy and all 21 finalized mint-router authorities: `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`
- Previous exposed authority: `B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n`
- Approved local SBF binary SHA-256: `4d1884c400321e4b230782858fcefd211c845c774c47b8630e83b4fc552c4b60`
- Finalized ProgramData SHA-256: `2973fcf4682b3c467fd9547c30ab943c55b78b5fe272c2e99b0286ead676220e`

The upgrade authority was transferred first, then the reviewed program was deployed. Three finalized rotation transactions updated the 19 preexisting mint routers. Two subsequent test launches inherited the new authority. `scripts/verify-devnet-router-rotation.mjs` verifies the deployed bytes, upgrade authority, router headers, and rejection of an old-key vault-creation simulation without sending that attempted transaction.

The live Devnet app, reward worker, and buyback worker were recreated with the rotated runtime configuration. The app uses a patch image over its existing UI image so unrelated UI work is not deployed. A normal future app and worker image rebuild must include the committed `server/automatic-reward-chain.mjs` change. The app health endpoint reported `automaticRewards: true`; its X fee status endpoint reported `ready: true` with no reasons. The fee collector was healthy.

Finalized live checks used a separate funded QA creator wallet: a new Pump token launch, buy, creator-fee collection, and transfer from its mint router to a reward vault all completed with verified balance deltas. The new router authority also created and paid SOL and token reward cycles with finalized recipient deltas. The old key cannot create new reward vaults or cycles after rotation. Existing committed legacy cycles remain payable by design; one old-authority vault has a committed, unpaid 0.01 SOL cycle. No legacy vault funds were withdrawn or reallocated by this rotation.

Local ignored Devnet env and Docker secret files contain the new signer and program hash. Private keys and temporary upload signers are not in Git. The temporary upload buffer was closed after the first RPC retry failure, and its SOL was returned to the payer. The public `funded.vip` HTTPS endpoints could not be independently reached from this task environment, so the runtime observations above are from the local app endpoint behind the Devnet tunnel.
