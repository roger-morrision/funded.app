# X-linked creator fee claims (Devnet)

This route is **off by default**. Historical launches using the shared `funded-fee-router-v1` PDA cannot produce an X obligation: Pump creator-fee collections from that address are not attributable to one mint.

For a new X-linked launch, the wallet initializes a PDA seeded by `funded-mint-router-v2` and the new mint, and Pump records that PDA as the fee owner. The backend verifies the Pump creator, collects to that PDA, reads the confirmed transaction's router balance delta, and calculates the X share from the immutable launch policy. The X account must sign in through OAuth and sign a wallet-binding message; the first verified wallet cannot be changed. Settlement uses the router program's `settle_mint` instruction and a mint-scoped on-chain claim PDA, so retrying cannot pay twice.

Before enabling:

1. Build the updated program with an SBF toolchain supporting Rust 2024 dependencies, for example `cargo build-sbf --manifest-path programs/funded-fee-router/Cargo.toml --tools-version v1.53` from `contracts/funded-fee-router`. Local `cargo check` alone is **not** a deployable `.so`.
2. Upgrade the existing Devnet program ID with its current upgrade-authority keypair. Do not generate a new key or change the existing program ID without an explicit migration plan. Verify the deployed code and the legacy router header on-chain.
3. Configure `FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH` with the keypair matching the authority in the legacy router header. This is a server-only settlement key; never use a `VITE_*` variable or paste it into chat.
4. Configure `SOLANA_KEEPER_KEYPAIR_PATH`, `SOLANA_KEEPER_CONFIGURED=true`, and fund that dedicated Devnet keeper for transaction fees. Configure `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_BEARER_TOKEN`, and the exact `X_CALLBACK_URL` in the X developer app. The bearer token resolves the launch handle to X's stable user ID before any coin transaction is sent; payouts are bound to that ID, not a mutable handle.
5. Run `npm run verify:mint-router-v2`, `npm run verify:x-fee-server`, `npm run verify:launch-wizard`, and `npm run build`. Perform a Devnet-only end-to-end launch, fee collection, X OAuth, wallet signature, and settlement with ephemeral test identities and verify on-chain balance and claim-account deltas.
6. Set `FUNDED_MINT_FEE_ROUTER_ENABLED=true` only after the prior checks. The frontend reads `/api/x-fee/status` and blocks X shares when any prerequisite is missing.

The authenticated keeper calls `POST /api/keeper/collect` with the mint. A successful mint-verified collection creates the obligation automatically. The signed-in X user sees it in `/api/x-fee/claims` and can complete the claim in the app. The route does not claim that the other 80/20 policy destinations are already distributed; those obligations need their own verified settlement flow.
