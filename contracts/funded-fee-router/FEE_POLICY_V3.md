# Fee router v3: 5% buyback enforcement

The checked-in v2 `settle_mint` instruction checks router authority and records a transfer. It does not bind the transfer to the launch's category allocations. Changing the JavaScript policy does not upgrade a deployed program or reserve SOL in a contract-controlled buyback vault.

## Required versioned contract change

1. Initialize a new per-mint router PDA and immutable policy account for launches that opt into v3. Store the mint, router authority, five gross-fee category rates in basis points (`8000 / 1000 / 300 / 200 / 500`), creator-directed sub-destinations, referral resolution rules, and the dedicated buyback vault PDA. Reject policies whose category rates do not total `10000` basis points. Keep the v2 PDA and policy hash for existing launches.
2. Claim Pump creator fees into the v3 router PDA. A v3 settlement must consume a unique claim ID once, calculate all five obligations from the **confirmed amount actually claimed**, and verify the destination account for each category. The 500 basis-point buyback amount must move to the buyback vault in the same successful settlement transaction. Deterministic integer rounding must account for every lamport without exceeding the claim amount; include dust cases in tests.
3. The buyback vault must have no general withdrawal instruction. Only a separate, audited execution path may spend its balance on a verified $FUNDED market route, then burn the acquired $FUNDED using SPL `BurnChecked`. A reservation or swap is not itself a burn. Publish claim, buy, burn, and supply-delta receipts separately.
4. Migrate the API and launch client to the v3 PDA and instruction only after the contract is built, audited, deployed on Devnet, and exercised with finalized claims and payout balance deltas. Existing v2 launches keep their saved fee policies and settlement path.

## Acceptance checks before activation

- A 100 SOL finalized claim produces 80 SOL creator-directed, 10 SOL operations, 3 SOL referral obligations, 2 SOL community, and 5 SOL in the contract-controlled buyback vault.
- A caller cannot redirect the buyback transfer, lower its amount, substitute the mint, replay a claim ID, or withdraw buyback SOL as an operations payout.
- A one-lamport claim and other rounding boundaries settle exactly once with no lost or created lamports.
- A legacy v2 launch still calculates from its saved launch policy and does not silently change to 5%.
- A burn is displayed as confirmed only after its finalized `BurnChecked` transaction and mint supply decrease have been verified.

Until these checks pass, the website's 5% figure describes the new **application allocation policy**, not an on-chain-enforced buyback or a completed burn.
