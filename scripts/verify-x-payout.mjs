import assert from 'node:assert/strict';
import { buildXPayoutObligation, buildXPayoutPolicy, normalizeXHandle } from '../x-payout-policy.js';
import { deriveXFeeObligation } from '../server/x-fee-guard.mjs';
import { rewardView } from '../reward-discovery.js';
import { mutateClaimState } from '../server/claim-state.mjs';

if (normalizeXHandle('creator') !== '@creator') throw new Error('X handle normalization failed.');
const policy = buildXPayoutPolicy({ handle: '@creator', percent: 25, feeRouterAddress: 'router' });
if (policy.primaryRail.type !== 'x-money' || policy.fallbackRail.type !== 'sol-claim') throw new Error('X payout fallback policy is invalid.');
const obligation = buildXPayoutObligation({ claimSignature: 'claim-1', amountSol: 1.25, recipient: '@creator' });
if (obligation.primaryStatus !== 'pending-x-money' || obligation.fallbackStatus !== 'claimable-after-x-money-failure-or-ineligibility') throw new Error('X payout obligation state is invalid.');

const mint='So11111111111111111111111111111111111111112';
const router='11111111111111111111111111111111';
const signature='finalized-collection-fixture';
const state={launches:{[mint]:{mint,cluster:'devnet',onchainVerified:true,xUserId:'9000001',creator:router,pumpFeeRoute:{scope:'per-mint-v2',verified:true,router},feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:0,holderAirdropPercent:0,solClaimPercent:80},recipients:{xAccount:'@creator'}}}}},collections:{[signature]:{signature,mint,router,status:'collected',attribution:'mint-verified',onchainVerified:true,collectedLamports:'1000000000'}}};
const derived=deriveXFeeObligation(state,{mint,claimSignature:signature});
assert.equal(derived.xUserId,'9000001');
assert.equal(derived.amountLamports,'800000000');
assert.equal(derived.source,'verified-per-mint-router-collection');
for(const mutate of [
  value=>{value.collections[signature].onchainVerified=false;},
  value=>{value.collections[signature].status='pending';},
  value=>{value.launches[mint].xUserId='';},
  value=>{value.launches[mint].pumpFeeRoute.scope='shared';},
]){const changed=structuredClone(state);mutate(changed);assert.throws(()=>deriveXFeeObligation(changed,{mint,claimSignature:signature}));}

const claim={id:derived.id,xUserId:derived.xUserId,obligationId:derived.id,recipient:derived.recipient,publicKey:router,status:'paid',payoutSignature:'payout-fixture'};
assert.equal(rewardView(derived,claim,[]).receiptVerified,false,'A paid flag without finalized payout evidence is not claimed.');
const proof={claimId:derived.id,signature:claim.payoutSignature,to:router,amountLamports:800000000,source:'mint-router-settle-mint'};
assert.equal(rewardView(derived,claim,[proof]).receiptVerified,true);

const scoped={claims:{[derived.id]:claim},obligations:{[derived.id]:derived},collections:{[signature]:state.collections[signature]},launches:{[mint]:state.launches[mint]},payouts:{[`x:${derived.id}`]:{id:`x:${derived.id}`,claimId:derived.id}}};
await assert.rejects(mutateClaimState(scoped,derived.id,current=>{current.claims[derived.id].recipient='@attacker';}),/entitlement/);
console.log('X payout: policy shape, finalized collection eligibility, X user binding, verified-receipt gating and paid-claim immutability passed. No OAuth, signer, worker, RPC or payout used.');
