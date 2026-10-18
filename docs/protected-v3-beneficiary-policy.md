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
4. Deploy the matching app and workers together, then run a disposable Devnet launch, finalized collection, protected settlement, creator/holder/X funding, referral and operations approval, and buyback burn. Verify state and balance deltas.
5. Open the launch gate only after that evidence. Mainnet activation is a separate review.

The source implementation and local tests do not prove that the live Devnet program is upgraded or that the release gate is ready. Until steps 3–4 pass, `V3_BENEFICIARY_ROUTING_ON_CHAIN_ENFORCED` remains false and normal launches stay blocked.
