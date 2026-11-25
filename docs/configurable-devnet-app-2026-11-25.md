# Configurable Devnet app and financial regression — 2026-11-25

The Devnet app at https://funded.vip now uses configurable program `9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf`. Primary-token settings are available in Profile preferences to the on-chain administrator. The flow reviews and simulates the exact instruction, signs through the wallet, waits for finalized transaction and immutable revision evidence, then reloads the app with the new configuration.

The program ELF SHA-256 is `55a07af3f185f0dd42c7d80785438ec502e3c74d2382fb7910a7d66827c646e7`; its full ProgramData commitment is `06ec1e5bf75e5249b6a174a68066ba13c6a0495eecae45f7841a8047373ee53e`. Upgrade authority remains `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`. The [earlier bytecode upgrade report](devnet-program-upgrade-2026-11-25.md) records the finalized upgrade and account-preservation checks.

## Live checks

| Scenario | Observed result |
| --- | --- |
| Browser token change C5 → 8F → C5 | Finalized revisions 8 and 9; API, quote configuration, and header token link agreed after reload. Unauthorized wallet was disabled; mismatched mint/pool failed before signing. |
| Launches under both token configurations | Real Pump launches, application registration, service fee, 3% community reserve and developer escrow verified. |
| Buy and sell fees | Each scenario verified the expected 1% application-fee balance delta. |
| Fee collection and settlement | Each collected 1,135,743 lamports; category totals matched the collected amount. Repeated settlement returned the original signature. |
| Creator and operations payouts | Finalized recipient credits matched the approved amounts. Repeated creator claims returned the original signature. |
| Referrals | Levels 1, 2 and 3 paid with exact recipient balance deltas; replays did not create another payment. |
| Holder rewards | Finalized bitmap payouts for both token configurations; recipient credits and reward-vault debits verified. |
| Daily bonuses | Finalized recipient credits and vault debits for both token configurations; repeated execution retained identical receipts. Devnet uses accelerated five-minute windows. |
| Protocol buyback and burn | Finalized purchases and burns of both C5 and alternate 8F; application proofs verified vault debit, token burn and balance changes. |
| Fee split and agency rules | Revision 3 changed operations/community from 40/20 to 39/21, milestone thresholds from 1/2 to 2/4 USD, and timing windows from 300 to 600 seconds. A new launch adopted these settings and completed collection, settlement, payouts and alternate-token burn. |
| Historical terms | Finalized per-mint policies retained their launch-time split, revision and timing rules after the global configuration changed and was restored. |

The variant settlement credited operations 88,588 and community 47,701 lamports, versus 90,859 and 45,429 for the baseline. Creator and holder allocations remained 795,019 and 113,575 lamports. Referral rounding follows cumulative category boundaries, so individual levels can differ by one lamport when preceding categories change.

Token configuration was restored to C5 at revision 11. Agency configuration was restored at revision 4 to the original 40/20 split, thresholds and timing. The original administrator was restored and spare test SOL was refunded with finalized transactions. All six final release services and the on-chain program commitment passed verification. All six daily-bonus payment records retained their original signatures after the final restart. Test wallet keys stayed in process memory.

## Application changes and verification

The app, quotes, buybacks, independent price signer, market reader and burn totals read the finalized primary-token configuration. New community distributions use the active eligibility mint; existing distributions keep their saved mint. Stale configuration revisions and unapproved program commitments fail closed. The release contains the matching configurable ABI across app, workers and signers.

Financial executions ran on release `25ff4260cc6d755a94f15988ea90d105880e5789`. Final release `57798b5f3174f4b28dab833db660462751063419` additionally extracts manual community-claim setup to satisfy the source-size limit. Its image is `sha256:5449ccc6f0a078df1bdd8107ff6821946c77f87f8545760cd7a0b25c8953b54a`. An intermediate extraction release failed startup because the signer factory was read before initialization. The previous release was restored; initialization order was corrected and the exact final image passed an isolated API-only startup and HTTP build-identity check before redeployment.

Validation: 82 security tests passed on the host and in the exact Node 24 image; 98 focused financial compatibility/recovery tests passed locally with explicit offline fixtures. JavaScript syntax and the 1,552-file source-size checks passed after extraction. Local tests are separate from the finalized Devnet receipts. CCE was re-indexed after source changes.

Initial harness attempts encountered listing-cache delay, missing wallet-session authentication, and assertions expecting a signing challenge when the application had already finalized the payout. The harness was corrected; saved finalized receipts and exact balance checks subsequently verified both original launches. A tiny earlier allocation was correctly rejected by the buyback minimum. The substantive alternate-token burn used the larger new launch allocation.

## Remaining coverage limits

Historical status at the end of this run: the [follow-up migration and bytecode-upgrade acceptance](devnet-upgrade-full-flow-2026-11-25.md) supersedes the migration funding estimate and records the later holder payout, AI burns and before/after upgrade tests. The statements below describe the earlier run, not the current deployment.

- AI agency **own-coin milestone burns** and migration-triggered community token delivery were not completed live. These newly launched coins have no canonical migrated PumpSwap pool; the app rejects execution and retains the agency budget. Finalized policies show 22,715 lamports retained per tested launch. Available dedicated Devnet funding is insufficient to complete a fresh Pump curve. Existing compiled-SBF financial CPI tests cover the program path locally, but do not replace live execution evidence.
- Business flows were exercised before and after **configuration changes on already-upgraded bytecode**. A complete live business-flow baseline before the earlier bytecode upgrade was not captured. The separate upgrade report supplies the loader transaction, exact artifact and account-preservation evidence.
- The failed intermediate app deployment interrupted holder sampling for the third fixture's first reward window. That window correctly blocked with `Finalized holder snapshots do not cover this reward period`; its funding remains retained. Holder payouts are proven for the first two fixtures, not the third. Daily bonuses completed for all three fixtures and retained the same receipts after restart. This demonstrates that deployments can delay sampling-dependent payouts; zero-impact upgrades are not claimed.
- The rehearsal does not certify arbitrary future upgrades or Mainnet readiness. Future releases still require ABI, account-layout, authority and exact ProgramData compatibility checks, plus applicable financial-flow tests.

Exact public signatures, amounts, revisions and verification flags are in the [JSON evidence](evidence/configurable-devnet-app-2026-11-25.json). No Mainnet transaction was sent.
