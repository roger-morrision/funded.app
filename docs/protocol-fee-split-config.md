# Protocol fee split configuration

Edit [`config/protocol-fee-split.js`](../config/protocol-fee-split.js) to change how funded.vip's **20% share** of collected Pump creator fees is allocated. The creator-directed 80% stays fixed. The four destinations are operations, three referral levels, community programs reserve, and $FUNDED buyback and burn.

For example, the current config allocates 50% to operations, 10%/3%/2% to referral levels 1/2/3, 10% to community, and 25% to buyback. These values total 100% of the app share, equivalent to 10%, 2%/0.6%/0.4%, 2%, and 5% of gross collected creator fees.

All percentages in the config must be finite, nonnegative, at most 100, have no more than four decimal places, and total exactly 100. Invalid settings stop the API at startup and fail the frontend build. Rebuild the frontend and restart the API together after an edit. New launches save the resulting split in their immutable fee policy; existing coins and previously recorded settlements retain their saved percentages. Missing referral levels continue to flow into the community reserve.

The current router contract verifies authority and records transfers, but it does not enforce the 80/10/3/2/5 allocation on-chain. The server calculates and stores obligations from each launch's immutable policy. Do not describe the new percentages as contract-enforced until a versioned router with category-specific limits is built, audited, deployed, and adopted for new launches. The existing policy hash identifies the router header and must not be changed in place because deployed router accounts depend on it. See the [v3 contract migration requirements](../contracts/funded-fee-router/FEE_POLICY_V3.md).

Run `npm run verify:fee-policy`, `node scripts/verify-coin-fee-overview.mjs`, and `npm run build` before deployment. These checks verify the policy math and display model locally; they do not prove Devnet collection or payout execution.
