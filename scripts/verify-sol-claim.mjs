import { buildSolClaimObligation, buildSolClaimPolicy, normalizeXHandle } from '../sol-claim-policy.js';

if (normalizeXHandle('creator') !== '@creator') throw new Error('X handle normalization failed.');
const policy = buildSolClaimPolicy({ handle: '@creator', percent: 25, feeRouterAddress: 'router' });
if (policy.payoutRail.type !== 'solana' || policy.mode !== 'x-handle-sol-claim') throw new Error('SOL claim policy is invalid.');
const obligation = buildSolClaimObligation({ claimSignature: 'claim-1', amountSol: 1.25, recipient: '@creator' });
if (obligation.status !== 'claimable-after-wallet-verification') throw new Error('SOL claim obligation state is invalid.');
console.log('SOL claim checks passed');
