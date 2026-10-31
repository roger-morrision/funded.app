import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticV3Actions} from '../server/automatic-v3-actions.mjs';
test('automation selects exact funded allocations and leaves ambiguous transfers for reconciliation',()=>{
  const state={launches:{mint:{cluster:'devnet',onchainVerified:true}},v3Settlements:{source:{mint:'mint',status:'finalized',
    referralUpline:['referrer'],allocationPlan:{status:'allocated-not-funded',creatorDirected:{walletLamports:'60',holderLamports:'10',xLamports:'10'},
      protocol:{communityLamports:'4',operationsLamports:'8',referralLamports:['1','0','0']}}}},
    v3CreatorWalletPayout:{source:{status:'verification-pending',signature:'uncertain'}}};
  const rows=automaticV3Actions(state);
  assert.deepEqual(rows.map(row=>row.action),['creator-reward-funding','community-funding','operations-payout','referral-payout']);
  assert.equal(rows.at(-1).level,1);
  state.launches.mint.archivedAt=new Date().toISOString();assert.deepEqual(automaticV3Actions(state),[]);
});
