import { buildXPayoutObligation, buildXPayoutPolicy, normalizeXHandle } from '../x-payout-policy.js';

if (normalizeXHandle('creator') !== '@creator') throw new Error('X handle normalization failed.');
const policy = buildXPayoutPolicy({ handle: '@creator', percent: 25, feeRouterAddress: 'router' });
if (policy.primaryRail.type !== 'x-money' || policy.fallbackRail.type !== 'sol-claim') throw new Error('X payout fallback policy is invalid.');
const obligation = buildXPayoutObligation({ claimSignature: 'claim-1', amountSol: 1.25, recipient: '@creator' });
if (obligation.primaryStatus !== 'pending-x-money' || obligation.fallbackStatus !== 'claimable-after-x-money-failure-or-ineligibility') throw new Error('X payout obligation state is invalid.');
console.log('x payout checks passed');
