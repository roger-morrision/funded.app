# Protocol fee split configuration

The default agency policy for new V3 launches is **80% creator-directed / 8% Operations & marketing / 1% referral network / 2% AI agency / 4% Daily bonus / 5% $FUNDED buyback**, measured against gross collected Pump creator fees. Referral levels are 0.6% / 0.25% / 0.15%. The creator-directed 80% follows the launch-time wallet, holder and X allocation; it is not necessarily all paid to the creator wallet.

The authoritative policy is the verified on-chain configuration published through the admin workflow, not a file default or a deployment report. See [configurable financial rules](configurable-financial-rules.md) for the authority-signing workflow, launch snapshots, limits and evidence requirements.

`config/marketing-agency.js` contains the new-launch defaults. `config/agency-rules.js` contains default thresholds and claim/billing intervals. `config/protocol-fee-split.js` remains the older seven-category fallback (including its 3% referral total), which must not be presented as the published agency policy. Existing coins retain their recorded rates. File edits alone cannot change on-chain configuration or a saved mint policy.

Protocol categories are percentages of the fixed 20% app share and must total 100% of that share. Multiply by 0.2 to obtain the gross-fee rate. New agency configuration is authority-signed, revision-bound and verified before publication. Browser bootstrap reads `/api/fee-policy`; token-specific allocations use that token's saved policy.

V3 initializes per-mint category units on-chain and uses the recorded policy for settlement and protected category withdrawals. Deployment, enabled gates and finalized transaction evidence must be checked independently; seeing a policy on a page is not proof of a funded vault, payout or burn. Current application routes use V3.

Daily bonus uses the base community allocation of launches that recorded the Daily bonus policy. It is split equally among top creators, direct referrers and traders for a completed UTC day; each group pays ranks 1/2/3 at 50%/30%/20% of its category budget. New fee rankings and eligibility use finalized settlement time, while traders use finalized execution time. Selected Devnet QA coins use labeled five-minute windows. Verified snapshots and creator-approved source funding are required. Missing ordinary referral levels remain in the community reserve and are not Daily bonus funding. Community token airdrops are a separate launched-token program. See [Daily bonus rules and evidence](daily-bonus-policy.md).

Daily bonus winners receive automatic SOL transfers after snapshot and source-funding verification; they do not claim or sign. The worker checks every five minutes after the daily cutoff. Ordinary referral recipients also have no separate V3 claim, but those transfers need creator approval.

Run `npm run verify:fee-policy`, `npm run verify:proof-ui`, the fee-policy browser regressions and `npm run build` before deployment. These checks establish local math and UI behavior; finalized on-chain receipts establish actual payments.
