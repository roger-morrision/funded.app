# Protocol fee split configuration

The current policy for new V3 launches is **80% creator-directed / 8% Operations & marketing / 3% referral network / 4% Daily bonus / 5% $FUNDED buyback**, measured against gross collected Pump creator fees. The creator-directed 80% follows the launch-time wallet, holder and X allocation; it is not necessarily all paid to the creator wallet.

This is the published deployment policy before agency activation. The [approved agency policy](marketing-agency-policy.md#approved-rules) reserves 1% for referrals and 2% for AI agency; its activation remains pending. Daily bonus remains 4%. The referral overview and guidance explicitly show the approved rates with an activation label, while saved coin entitlements retain their actual rates.

Edit [`config/protocol-fee-split.js`](../config/protocol-fee-split.js) to divide only the fixed protocol 20%. Current values are 40 operations, 10/3/2 referral levels, 20 Daily bonus and 25 buyback. They total 100% of the app share. Multiply each by 0.2 for its gross-fee rate. A saved admin policy overrides this build default. The authenticated admin editor publishes a version for future launches; existing mint policies and historical settlements retain their recorded percentages.

Rates must be finite, nonnegative, at most 100, have at most four decimal places and total 100. Invalid configuration fails startup/build. Rebuild the frontend and restart the API together after a file edit. Browser bootstrap reads `/api/fee-policy` before enabling the app. Collection allocation calculators and illustrations use that active policy; the referral example is labeled as an approved-policy preview until activation. Token-specific allocations continue to use that token's saved policy.

V3 initializes per-mint category units on-chain and uses the recorded policy for settlement and protected category withdrawals. Deployment, enabled gates and finalized transaction evidence must be checked independently; seeing a policy on a page is not proof of a funded vault, payout or burn. Current application routes use V3.

Daily bonus uses the base community allocation of launches that recorded the Daily bonus policy. It is split equally among top creators, direct referrers and traders for a completed UTC day; each group pays ranks 1/2/3 at 50%/30%/20% of its category budget. New fee rankings and eligibility use finalized settlement time, while traders use finalized execution time. Selected Devnet QA coins use labeled five-minute windows. Verified snapshots and creator-approved source funding are required. Missing ordinary referral levels remain in the community reserve and are not Daily bonus funding. Community token airdrops are a separate launched-token program. See [Daily bonus rules and evidence](daily-bonus-policy.md).

Daily bonus winners receive automatic SOL transfers after snapshot and source-funding verification; they do not claim or sign. The worker checks every five minutes after the daily cutoff. Ordinary referral recipients also have no separate V3 claim, but those transfers need creator approval.

Run `npm run verify:fee-policy`, `npm run verify:proof-ui`, the fee-policy browser regressions and `npm run build` before deployment. These checks establish local math and UI behavior; finalized on-chain receipts establish actual payments.
