# Protocol fee split configuration

Edit [`config/protocol-fee-split.js`](../config/protocol-fee-split.js) to change how funded.vip's **20% share** of collected Pump creator fees is allocated. The creator-directed 80% stays fixed. The four destinations are operations, three referral levels, community programs reserve, and $FUNDED buyback and burn.

For example, the current config allocates 70% to operations, 10%/3%/2% to referral levels 1/2/3, 10% to community, and 5% to buyback. These values total 100% of the app share, equivalent to 14%, 2%/0.6%/0.4%, 2%, and 1% of gross collected creator fees.

All percentages in the config must be finite, nonnegative, at most 100, have no more than four decimal places, and total exactly 100. Invalid settings stop the API at startup and fail the frontend build. Rebuild the frontend and restart the API together after an edit. New launches save the resulting split in their immutable fee policy; existing coins and previously recorded settlements retain their saved percentages. Missing referral levels continue to flow into the community reserve.

Run `npm run verify:fee-policy`, `node scripts/verify-coin-fee-overview.mjs`, and `npm run build` before deployment. These checks verify the policy math and display model locally; they do not prove Devnet collection or payout execution.
