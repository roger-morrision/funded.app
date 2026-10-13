import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedCreatorState } from '../server/creator-state.mjs';
import { buildCreatorSupport } from '../server/creator-support.mjs';

const mint='5'.repeat(44), router='2'.repeat(44), wallet='4'.repeat(44);
const source='3'.repeat(64), payout='6'.repeat(64), id='123';
const fixture=()=>({ launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true,
  policySignature:'signed-fixture', xUserId:id, creator:router, creatorWallet:wallet,
  pumpFeeRoute:{verified:true,scope:'per-mint-v3',router},
  feeDistribution:{creatorDirected:{shares:{solClaimPercent:5},recipients:{xAccount:'@fixture'}}} } },
  collections:{ [source]:{ signature:source,mint,scope:'per-mint-v3',status:'collected',
    onchainVerified:true } },
  v3Settlements:{ [source]:{ status:'finalized',mint,allocationPlan:{
    status:'allocated-not-funded', creatorDirected:{ xLamports:'80000000',
      holderLamports:'20000000' } } } },
  v3CreatorRewardFunding:{ [source]:{ status:'finalized',mint,amount:'100000000',
    signature:source,balanceDeltaVerified:true } },
  v3XClaims:{ [source]:{ mint,xUserId:id,status:'paid',wallet,
    amountLamports:'80000000',fundingSignature:source,
    payment:{ signature:payout,amount:'80000000',finalized:true,
      balanceDeltaVerified:true } } }, creatorProfiles:{} });

test('creator profile lists only matching finalized V3 X payments', () => {
  const state=fixture();
  const scoped=scopedCreatorState(state,id,'devnet');
  assert.equal(buildCreatorSupport(scoped,id,null,'devnet').paidLamports,'80000000');
  assert.equal(buildCreatorSupport(scoped,id,null,'devnet').receipts[0].signature,payout);
  assert.equal(buildCreatorSupport(scoped,id,null,'devnet').evidenceStatus,'recorded-finalized-v3');
  for(const mutate of [
    s=>{s.v3XClaims[source].payment.finalized=false;},
    s=>{s.v3XClaims[source].payment.amount='1';},
    s=>{s.v3CreatorRewardFunding[source].balanceDeltaVerified=false;},
    s=>{s.v3XClaims[source].fundingSignature='other';},
    s=>{s.v3Settlements[source].allocationPlan.creatorDirected.xLamports='1';},
  ]) { const changed=fixture(); mutate(changed);
    assert.equal(buildCreatorSupport(scopedCreatorState(changed,id,'devnet'),id,null,'devnet').paidLamports,'0'); }
  const old=fixture();old.launches[mint].pumpFeeRoute.scope='per-mint-v2';
  assert.equal(buildCreatorSupport(scopedCreatorState(old,id,'devnet'),id,null,'devnet'),null);
});
