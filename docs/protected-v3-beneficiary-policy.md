# Protected V3 beneficiary policy

## Why this is a separate launch path

The deployed V3 `MintFeePolicyV3` account is 249 bytes. It fixes the 80/20 split and six protocol category rates, but it has no creator/holder/X subshare counters or approved recipient records. Existing mints keep that account and their saved obligations. New protected mints use the same router and seven category vault addresses with a 293-byte policy account. The 44-byte extension contains a version magic, three immutable gross-fee share units, and three cumulative released amounts.

The old `disburse_mint_v3` instruction rejects a 293-byte policy account. This prevents a protected mint from bypassing the new checks. The old instruction remains available to existing 249-byte policies. Settlement and the atomic buy-and-burn path retain the existing vault layout and budget accounting.

## New mint and release rules

- The launch transaction initializes the protected policy with creator, holder, and X units totaling 8,000,000 of 10,000,000 gross-fee units. The six protocol units still total 2,000,000.
- The creator category remains in its per-mint vault after settlement. Direct creator transfers cannot exceed the creator share. Transfers to the proof-gated reward vault include an explicit holder amount; the remaining amount is the X share. Both have independent on-chain cumulative caps.
- Operations and referral categories remain in their own per-mint vaults. Each payout requires an approval account for an exact mint, withdrawal ID, category, recipient, and amount. The current router authority and launch creator sign the approval. The disbursement instruction consumes that approval and creates a one-time withdrawal receipt in the same transaction.
- Community funds may enter only the mint's proof-gated reward vault. Buyback funds remain restricted to the atomic purchase-and-burn instruction.
- The server verifies the finalized program bytecode, policy layout and shares, exact instructions, approval record, withdrawal receipt, and vault/recipient balance deltas before recording a payout. Referral eligibility is still established by the frozen app referral graph; the on-chain approval binds its resulting wallet and amount. X identity and wallet ownership remain verified by the OAuth and wallet-signed claim flow before reward-vault payout.

## Release sequence

1. Build one exact Devnet SBF artifact and pass LiteSVM tests for protected and legacy policies, including failed bypass and share-cap attempts.
2. Verify the Devnet program upgrade authority, bytecode size, genesis hash, backup and worker state. Keep new launches closed throughout the upgrade.
3. Upgrade only the isolated Devnet V3 program. Independently read finalized ProgramData and compare its bytes to the tested SBF. Pin the resulting ProgramData SHA-256 in the app release configuration.
4. Deploy the matching app and workers together. Exercise a protected mint through finalized settlement and approved payouts, and exercise Pump launch, collection, and settlement on the upgraded binary. Verify state and balance deltas for each path.
5. Open the launch gate only after those checks and release readiness pass. Continue the public wallet, holder distribution, X payout, and buyback burn journeys as separately reported Devnet checks. Mainnet activation is a separate review.

## Devnet evidence, 2026-10-18

- Exact tested SBF: 720,664 bytes, SHA-256 `7fcbfa58c81e22455160827c44f520a1f0d2a071d2bc30916fff0bafc1d30d6d`. The rebuilt binary passed the protected and legacy LiteSVM tests.
- Finalized isolated program: `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`, ProgramData SHA-256 `53b6910f00d436d2a2418e441ef9898744d9414ff1ba85f9e2454e4dab3ace81`. Independent byte comparison matched the tested binary and dedicated upgrade authority.
- Protected policy QA mint `LPsNSXyERvFXSVFk58edgNBMUtXmTpmBZRixjawsWS7` finalized initialization, settlement, direct creator release, combined holder/X reward-vault funding, operations approval and payout, and referral approval and payout. Exact receipt and balance-delta checks passed. Protected operations payout: `4An1r3qtzXmTFCcY8qUkqg9XUnLuHXUwaQRLoBb3gPpuTUsC82YSDrHNh1YLHThNYRUH3mPhUZrjYdTTLSQdbwD8`; protected referral payout: `3woJwN86qzTY7AhVDF3jheNgcuVRnPRKJfwyb9ACNnpEZcTBSQ7GanML29Qk4Ag3JfCWcndinW3aydEXswQds8qu`.
- Pump integration QA mint `HFrtQeZBZ9Y6LTtJhC7nTWboAKraPZSsLdbAGzRytQvp` finalized a launch `66SoTWJkXvh2KqjMw7gHLzCpboYCxeFuEAqT38TmPLk5JLcJ3nTt61ZAVWVKMFmTmCYmR7CzoS6XLdWHSoquqkFA`, buy, creator-fee collection `62bQuCm5Vs6XTwNnrfRjo7ATK9TjKzsCu6JYzKbRoRnmF5uzjiENzhdPLuEmhqjFSNnwfQFBDQUQgfd9Y1KTL7D`, and settlement `3jFoo7m2JtrgCGE4F3rQSywQBnB1EMhZfiAvDWfpCKH35ifvV87tcdH8b3AYnsBvfnakcZi6MFLfDrTHAy8qTM6X` on the upgraded binary. This mint used the legacy 249-byte policy to establish compatibility with existing mints; the protected mint test established the new 293-byte policy path.

The launch gate now requires the exact reviewed ProgramData hash, healthy worker evidence, active lookup tables, and enabled Devnet routes. The synthetic protected QA and Pump integration QA are separate mints. A public browser wallet launch, holder distribution, X payout, and buyback burn have not been observed in this release and must not be claimed from these receipts.
