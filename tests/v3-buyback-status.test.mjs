import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewardStatusRoutes } from '../server/routes/reward-status.mjs';

test('V3 buyback status retains exact unspent allocation after a recorded burn',async()=>{
  const signature='3'.repeat(64);
  const state={v3Settlements:{[signature]:{status:'finalized',
    mint:'mint',collectionSignature:signature,
    allocationPlan:{status:'allocated-not-funded',
      protocol:{buybackLamports:'1000000'}}}},
    v3BuybackOrders:{[signature]:{status:'finalized',finalized:true,
      spentLamports:'950000',burnedBaseUnits:'125000',
      vaultDebitVerified:true,burnInstructionVerified:true,
      preparedTransaction:'private',signedTransaction:'private',
      pumpData:'private',pumpKeys:[]}},buybackOrders:{}};
  const responses=[];
  const route=createRewardStatusRoutes({store:{read:async()=>state},
    solanaCluster:'devnet',respond:(_res,status,data)=>responses.push({status,data})});
  await route({method:'GET'}, {},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(responses.at(-1).data.executionReady,false);
  assert.equal(responses.at(-1).data.pending[0].amountLamports,'50000');
  assert.equal(responses.at(-1).data.pending[0].status,'verified-burn-residue');
  assert.equal(responses.at(-1).data.receipts.length,1);
  assert.equal(responses.at(-1).data.receipts[0].signedTransaction,undefined);
});

test('a queued buyback cycle reports its verified residue for the next round',async()=>{
  const source='3'.repeat(64),programId='9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
  const state={v3Settlements:{[source]:{status:'finalized',mint:'mint',
    programId,collectionSignature:source,allocationPlan:{status:'allocated-not-funded',
      protocol:{buybackLamports:'1000000'}}}},v3BuybackOrders:{
    [source]:{status:'finalized',collectionSignature:source,programId,
      cycleId:'cycle-1',finalized:true,vaultDebitVerified:true,
      burnInstructionVerified:true,spentLamports:'300000'},
    [`${source}:2`]:{status:'finalized',collectionSignature:source,programId,
      cycleId:'cycle-1',round:2,finalized:true,vaultDebitVerified:true,
      burnInstructionVerified:true,spentLamports:'400000'} }};
  const replies=[];
  const route=createRewardStatusRoutes({store:{read:async()=>state},solanaCluster:'devnet',
    respond:(_res,status,data)=>replies.push({status,data})});
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(replies.at(-1).data.pending[0].amountLamports,'300000');
  assert.equal(replies.at(-1).data.pending[0].status,'queued');
});

test('only a finalized burn for the enabled current Devnet program opens buyback readiness', async () => {
  const programId = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
  const hash = 'a'.repeat(64);
  const state = { v3BuybackOrders:{ qa:{ status:'finalized', finalized:true,
    vaultDebitVerified:true, burnInstructionVerified:true,
    programId, approvedHash:hash, spentLamports:'123127' } } };
  const responses = [];
  const env = { FUNDED_V3_BUYBACK_ENABLED:'true',
    FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
    FUNDED_V3_PROGRAM_DATA_SHA256:hash };
  const route = createRewardStatusRoutes({ store:{ read:async () => state },
    automaticRewardStore:{ read:async () => ({}) }, solanaCluster:'devnet', env,
    respond:(_res,status,data) => responses.push({status,data}) });
  await route({method:'GET'}, {}, new URL('https://funded.vip/api/buyback/status'));
  assert.equal(responses.at(-1).data.executionReady, true);
  assert.equal(responses.at(-1).data.mainnetReady, false);
  await route({method:'GET'}, {}, new URL('https://funded.vip/api/rewards/automatic'));
  assert.equal(responses.at(-1).data.routeReadiness.buyback.ready, true);
  assert.equal(responses.at(-1).data.routeReadiness.buyback.verifiedV3Burns, 1);
  assert.equal(responses.at(-1).data.modes.buyback, 'verified-v3-devnet-execution');
  env.FUNDED_V3_PROGRAM_DATA_SHA256 = 'b'.repeat(64);
  await route({method:'GET'}, {}, new URL('https://funded.vip/api/buyback/status'));
  assert.equal(responses.at(-1).data.executionReady, false);
});
