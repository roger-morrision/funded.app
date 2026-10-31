# Devnet on-chain automation

The keeper collects Pump creator fees, settles verified collections into saved-policy vaults, and releases eligible allocations without repeated creator signatures. `FUNDED_V3_AUTO_SETTLEMENT_ENABLED` and `FUNDED_V3_AUTO_DISBURSEMENT_ENABLED` activate these paths only after deployment of the tested program and verification of its finalized ProgramData hash.

The current router authority initializes one immutable `mint-automation-v3` PDA per mint. It binds the mint, creator, exact protected or agency policy, operations wallet, and three referral wallets frozen at the first qualified settlement. Missing referral wallets cannot receive automatic payments. Existing on-chain creator/holder/X share caps, reward-vault destination checks, category budgets, approval receipts, and withdrawal replay protection apply to every automatic release. The authority remains a trusted attestor of eligibility; this is not a permissionless entitlement oracle. Unprotected historical policies cannot enroll.

The collector service calls authenticated keeper routes. It preserves transactions with uncertain outcomes for reconciliation. It does not automatically retry recorded pending transfers. Recipient rent requirements, configured minimums, market checks, holder periods, daily ranking windows and proof checks still apply.

Token creation and discretionary trades require the initiating wallet signature. X identity requires OAuth; token airdrop claims require the applicable ownership proof. Real Pump migration requires Pump's actual conditions. Tests using fabricated eligibility or migration fixtures must be labelled as fixtures. Signatures and HTTP responses alone do not prove payment: finalized transactions, policy receipts and exact balance changes are required.

Old Devnet launches may be archived from active listings and new automation. Their receipts, balances and Solana history remain available; archiving does not erase a mint or spend its balances. Back up state and record an exact mint manifest before applying an archive.
