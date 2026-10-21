import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {agencyPublicSummary} from '../server/agency-public-summary.mjs';
import {createMarketingAgencyRoutes} from '../server/routes/marketing-agency.mjs';
const mint=Keypair.fromSeed(Buffer.alloc(32,246)).publicKey.toBase58(),programId=Keypair.fromSeed(Buffer.alloc(32,247)).publicKey.toBase58();
function fixture(){
  const now=Date.now(),approvedHash='a'.repeat(64),build='b'.repeat(40);
  const state={launches:{[mint]:{mint,onchainVerified:true,cluster:'devnet',marketingAgency:{selectedAgents:['x-promotion']},
    pumpFeeRoute:{programId,protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}}}},adminSettings:{agencyBudgets:{}}};
  const args={state,programId,approvedHash,build,now};
  const row={mint,verified:true,scope:'finalized-pump-sources-and-agency-vault',programId,approvedHash,build,slot:123,
    policyFingerprint:'c'.repeat(64),checkedAt:new Date(now).toISOString(),paidLamports:'20000000',spentLamports:'1000000',selectedMask:1};
  return{args,state,row};
}
test('public totals require fresh matching finalized worker snapshots for every registered agency mint',()=>{
  const f=fixture();assert.equal(agencyPublicSummary(f.args).funding.collectedLamports,null);
  f.state.adminSettings.agencyBudgets[mint]=f.row;assert.equal(agencyPublicSummary(f.args).funding.collectedLamports,'20000000');
  assert.equal(agencyPublicSummary(f.args).funding.spentLamports,'1000000');
  f.row.spentLamports='20000001';assert.equal(agencyPublicSummary(f.args).funding.collectedLamports,null);f.row.spentLamports='1000000';
  assert.equal(agencyPublicSummary({...f.args,now:f.args.now+180001}).funding.collectedLamports,null);
  f.row.approvedHash='d'.repeat(64);assert.equal(agencyPublicSummary(f.args).funding.collectedLamports,null);
});
test('public activation requires verified normal-flow readiness; journal secrets and unsigned executions are never history',async()=>{
  const f=fixture();let ready=false,response;
  f.state.v3AgencyExecutions={pending:{status:'verification-pending',signedTransaction:'private-journal-bytes',intent:{programId,mint}}};
  const env={FUNDED_V3_AGENCY_ENABLED:'true',FUNDED_V3_PROGRAM_DATA_SHA256:f.args.approvedHash,FUNDED_BUILD_ID:f.args.build};
  const handler=createMarketingAgencyRoutes({env,store:{read:async()=>f.state},readLaunchConfig:async()=>({ready,agency:{configRevision:'1'},protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10},programId}),
    respond:(_res,_status,value)=>response=value});
  await handler({method:'GET'},{},new URL('https://funded.vip/api/marketing-agency'));assert.equal(response.active,false);
  ready=true;await handler({method:'GET'},{},new URL('https://funded.vip/api/marketing-agency'));assert.equal(response.active,true);
  assert.equal(response.funding.collectedLamports,null);assert.deepEqual(response.history,[]);assert(!JSON.stringify(response).includes('private-journal-bytes'));
});

test('burn history uses receipt time instead of a later worker reconciliation time',()=>{
  const f=fixture(),burnedAt='2026-10-20T01:00:00.000Z';
  f.state.v3AgencyExecutions={burn:{status:'finalized',signature:'sig',finalizedAt:'2026-10-21T01:00:00.000Z',
    intent:{programId,approvedHash:f.args.approvedHash,mint,agent:1},proof:{signature:'sig',finalized:true,balanceDeltaVerified:true,burnedAt}}};
  assert.equal(agencyPublicSummary(f.args).history[0].finalizedAt,burnedAt);
});
