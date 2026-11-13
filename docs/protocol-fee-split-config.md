# Creator-fee allocation configuration

Product workflows: [all-page guide](product-guide.md). Documentation scope and dated evidence: [index](README.md).

The default agency policy for new V3 launches is **80% creator-directed / 8% Operations & marketing / 1% referral network / 2% AI agency / 4% Daily bonus / 5% $RICH buyback**, measured against gross collected Pump creator fees. Referral levels are 0.6% / 0.25% / 0.15%. The creator-directed 80% follows the launch-time wallet, holder and X allocation; it is not necessarily all paid to the creator wallet.

Paired launches (a coin quoted in USDC, an xStock, a stock or crypto instead of SOL) use this same policy through the same V3 router; there is no separate paired split. They stay blocked until the router can collect and settle creator fees paid in the paired token.

The authoritative policy is the verified on-chain configuration published through the admin workflow, not a file default or a deployment report. See [configurable financial rules](configurable-financial-rules.md) for the authority-signing workflow, launch snapshots, limits and evidence requirements.

`config/marketing-agency.js` contains the new-launch defaults. `config/agency-rules.js` contains default thresholds and claim/billing intervals. `config/protocol-fee-split.js` remains the older seven-category fallback (including its 3% referral total), which must not be presented as the published agency policy. Existing coins retain their recorded rates. File edits alone cannot change on-chain configuration or a saved mint policy.

Internal category weights normalize the shared allocation pool to 100%. That pool is 20% of collected creator fees, combining the 8% app allocation for Operations & marketing with 12% for referrals, bonuses and buybacks. It is not app revenue. Multiply a normalized weight by 0.2 to obtain its gross-fee rate; for example, an Operations & marketing weight of 40 means 8% of collected creator fees. New agency configuration is authority-signed, revision-bound and verified before publication. Browser bootstrap reads `/api/fee-policy`; token-specific allocations use that token's saved policy.

V3 initializes per-mint category units on-chain and uses the recorded policy for settlement and protected category withdrawals. Deployment, enabled gates and finalized transaction evidence must be checked independently; seeing a policy on a page is not proof of a funded vault, payout or burn. Current application routes use V3.

Daily bonus uses the base community allocation of launches that recorded the Daily bonus policy. It is split equally among top creators, direct referrers and traders for a completed UTC day; each group pays ranks 1/2/3 at 50%/30%/20% of its category budget. New fee rankings and eligibility use finalized settlement time, while traders use finalized execution time. Selected Devnet QA coins use labeled five-minute windows. Verified snapshots and exact source funding are required. Active automatic routes fund saved obligations; manual routes can require creator approval. Missing ordinary referral levels remain in the community reserve and are not Daily bonus funding. Community token airdrops are a separate launched-token program. See [Daily bonus rules and evidence](daily-bonus-policy.md).

Daily bonus winners receive automatic SOL transfers after snapshot and source-funding verification; they do not claim or sign. The worker checks every five minutes after the daily cutoff. Ordinary referral recipients also have no separate V3 claim. Active automatic routes pay the frozen upline after verified settlement and funding; manual routes can require creator approval.

Run `npm run verify:fee-policy`, `npm run verify:proof-ui`, the fee-policy browser regressions and `npm run build` before deployment. These checks establish local math and UI behavior; finalized on-chain receipts establish actual payments.
