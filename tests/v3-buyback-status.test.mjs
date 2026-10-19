import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewardStatusRoutes } from '../server/routes/reward-status.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const programId='9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';

test('automatic status returns unavailable current custody before the UI deadline while its scan is delayed',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let result;
  const route=createRewardStatusRoutes({store:{read:async()=>({})},automaticRewardStore:{read:async()=>({})},
    solanaCluster:'devnet',solanaRpcUrl:'https://unused.invalid',env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},
    connectionFactory:()=>({}),readBuybackDashboard:()=>new Promise(()=>{}),
    respond:(_res,_status,data)=>{result=data;}});
  const pending=route({method:'GET'},{},new URL('https://funded.vip/api/rewards/automatic'));
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(10_001);await pending;
  assert.equal(result.routeReadiness.buyback.ready,false);
  assert.match(result.routeReadiness.buyback.reasons.join(' '),/custody/);
});

test('simultaneous buyback views share one verification scan and its warm cache', async () => {
  let finish, reads=0;
  const replies=[];
  const route=createRewardStatusRoutes({store:{read:async()=>({})},solanaCluster:'devnet',
    solanaRpcUrl:'https://unused.invalid',env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},connectionFactory:()=>({}),
    readBuybackDashboard:()=>{reads++;return new Promise(resolve=>{finish=resolve;});},
    respond:(_res,_status,data)=>replies.push(data)});
  const request=()=>route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  const pending=[request(),request(),request()];
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);
  finish({status:'verified',collectedLamports:'29681',unindexedStatus:'verified',unindexedVaults:[]});
  await Promise.all(pending);
  assert.equal(replies.length,3);
  assert(replies.every(reply=>reply.dashboard.collectedLamports==='29681'&&reply.dashboard.checkedAt));
  await request();assert.equal(reads,1,'A completed scan remains cached for the normal bounded window.');
});

test('a failed shared buyback scan clears its pending request and can be retried', async () => {
  let reject, reads=0;
  const replies=[];
  const route=createRewardStatusRoutes({store:{read:async()=>({})},solanaCluster:'devnet',
    solanaRpcUrl:'https://unused.invalid',env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},connectionFactory:()=>({}),
    readBuybackDashboard:()=>{reads++;return reads===1?new Promise((_resolve,rejectRead)=>{reject=rejectRead;})
      :Promise.resolve({status:'verified',collectedLamports:'29681',unindexedStatus:'verified',unindexedVaults:[]});},
    respond:(_res,_status,data)=>replies.push(data)});
  const request=()=>route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  const pending=[request(),request()];await new Promise(resolve=>setImmediate(resolve));
  reject(new Error('Temporary RPC outage'));await Promise.all(pending);
  assert.equal(reads,1);assert(replies.every(reply=>reply.dashboard.status==='unavailable'));
  await request();assert.equal(reads,2);assert.equal(replies.at(-1).dashboard.status,'verified');
});

test('a hung scan times out, retries, and cannot overwrite fresh cache with its late result', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let finishLate,reads=0;const replies=[];
  const route=createRewardStatusRoutes({store:{read:async()=>({})},solanaCluster:'devnet',
    solanaRpcUrl:'https://unused.invalid',env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},connectionFactory:()=>({}),
    readBuybackDashboard:()=>{reads++;return reads===1?new Promise(resolve=>{finishLate=resolve;})
      :Promise.resolve({status:'verified',collectedLamports:'29681',unindexedStatus:'verified',unindexedVaults:[]});},
    respond:(_res,_status,data)=>replies.push(data)});
  const request=()=>route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  const pending=[request(),request()];await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(25_001);await Promise.all(pending);
  assert.equal(reads,1);assert(replies.every(reply=>reply.dashboard.status==='unavailable'));
  await request();assert.equal(reads,2);
  finishLate({status:'verified',collectedLamports:'999999'});await new Promise(resolve=>setImmediate(resolve));
  await request();assert.equal(reads,2);assert.equal(replies.at(-1).dashboard.collectedLamports,'29681');
});

test('Devnet QA trigger is passed through the public status without changing the standard gate', async () => {
  const replies=[];
  const input=[];
  const env={FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
    FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'true',
    FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:'10000000'};
  const route=createRewardStatusRoutes({store:{read:async()=>({})},
    solanaCluster:'devnet',solanaRpcUrl:'https://unused.invalid',env,
    connectionFactory:()=>({}),readBuybackDashboard:async args=>{
      input.push(args);return {status:'verified',collectedLamports:'15000000',
        thresholdLamports:String(args.thresholdLamports),triggerReached:args.thresholdLamports<=15_000_000n};
    },respond:(_res,status,data)=>replies.push({status,data})});
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(input[0].programId,programId);
  assert.equal(input[0].thresholdLamports,10_000_000n);
  assert.equal(replies.at(-1).data.dashboard.triggerReached,true);
  env.FUNDED_DEVNET_QA_MINIMUMS_ENABLED='false';
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(input[1].thresholdLamports,5_000_000_000n,
    'Changing profile invalidates the cached dashboard.');
  assert.equal(replies.at(-1).data.dashboard.triggerReached,false);
});

const verifiedSource = source => ({
  launches:{mint:{onchainVerified:true,cluster:'devnet',
    pumpFeeRoute:{scope:'per-mint-v3',programId}}},
  collections:{[source]:{signature:source,mint:'mint',status:'collected',
    onchainVerified:true,programId}},
});

test('small unsigned buyback allocations are disclosed without hiding submitted reconciliation',async()=>{
  const source='3'.repeat(64),state={...verifiedSource(source),v3Settlements:{[source]:{status:'finalized',mint:'mint',collectionSignature:source,
    allocationPlan:{status:'allocated-not-funded',protocol:{buybackLamports:'8911'}}}},v3BuybackOrders:{[source]:{status:'queued',programId}}};
  let output;const route=createRewardStatusRoutes({store:{read:async()=>state},solanaCluster:'devnet',env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},respond:(_res,_status,data)=>{output=data;}});
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(output.minimumOrderLamports,'10000');assert.equal(output.pending[0].amountLamports,'8911');assert.equal(output.pending[0].status,'below-minimum-order');
  state.v3BuybackOrders[source]={status:'verification-pending',signature:'4'.repeat(64),programId};
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(output.pending[0].status,'verification-pending');
  state.v3BuybackOrders[source].status='queued';
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(output.pending[0].status,'verification-pending','A queued record with a signature must reconcile despite its small residual.');
});

test('V3 buyback status retains exact unspent allocation after a recorded burn',async()=>{
  const signature='3'.repeat(64);
  const state={...verifiedSource(signature),v3Settlements:{[signature]:{status:'finalized',
    mint:'mint',collectionSignature:signature,
    allocationPlan:{status:'allocated-not-funded',
      protocol:{buybackLamports:'1000000'}}}},
    v3BuybackOrders:{[signature]:{status:'finalized',finalized:true,
      programId,
      spentLamports:'950000',burnedBaseUnits:'125000',
      vaultDebitVerified:true,burnInstructionVerified:true,
      preparedTransaction:'private',signedTransaction:'private',
      pumpData:'private',pumpKeys:[]}},buybackOrders:{}};
  const responses=[];
  const route=createRewardStatusRoutes({store:{read:async()=>state},
    solanaCluster:'devnet',env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},
    respond:(_res,status,data)=>responses.push({status,data})});
  await route({method:'GET'}, {},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(responses.at(-1).data.executionReady,false);
  assert.equal(responses.at(-1).data.pending[0].amountLamports,'50000');
  assert.equal(responses.at(-1).data.pending[0].status,'verified-burn-residue');
  assert.equal(responses.at(-1).data.receipts.length,1);
  assert.equal(responses.at(-1).data.receipts[0].signedTransaction,undefined);
  state.v3BuybackOrders[signature].spentLamports='1000000';
  await route({method:'GET'}, {},new URL('https://funded.vip/api/buyback/status'));
  assert.deepEqual(responses.at(-1).data.pending,[],
    'A fully spent source must not be displayed as buyback residue.');
});

test('a finished buyback cycle reports residue until another cycle is queued',async()=>{
  const source='3'.repeat(64);
  const state={...verifiedSource(source),v3Settlements:{[source]:{status:'finalized',mint:'mint',
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
    env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},
    respond:(_res,status,data)=>replies.push({status,data})});
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(replies.at(-1).data.pending[0].amountLamports,'300000');
  assert.equal(replies.at(-1).data.pending[0].status,'verified-burn-residue');
  state.v3BuybackOrders[`${source}:3`]={status:'queued',collectionSignature:source,
    programId,cycleId:'cycle-2',round:3};
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
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
  assert.equal(responses.at(-1).data.executionReady, false,
    'An old burn cannot establish current buyback execution readiness.');
  assert.equal(responses.at(-1).data.historicalExecutionVerified, true);
  assert.equal(responses.at(-1).data.mainnetReady, false);
  await route({method:'GET'}, {}, new URL('https://funded.vip/api/rewards/automatic'));
  assert.equal(responses.at(-1).data.routeReadiness.buyback.ready, false);
  assert.equal(responses.at(-1).data.routeReadiness.buyback.historicalExecutionVerified, true);
  assert.equal(responses.at(-1).data.routeReadiness.buyback.verifiedV3Burns, 1);
  assert.equal(responses.at(-1).data.modes.buyback, 'verified-v3-devnet-execution');
  env.FUNDED_V3_PROGRAM_DATA_SHA256 = 'b'.repeat(64);
  await route({method:'GET'}, {}, new URL('https://funded.vip/api/buyback/status'));
  assert.equal(responses.at(-1).data.executionReady, false);
});

test('buyback readiness follows fresh worker, program, RPC and funding gates while receipts remain historical', async () => {
  let clock=Date.parse('2026-10-19T04:00:00Z'), programReady=true, custodyReady=true;
  const rewards={buybackWorkerHeartbeat:{status:'ready',cluster:'devnet',at:new Date(clock).toISOString()}};
  const state={v3BuybackOrders:{past:{status:'finalized',finalized:true,vaultDebitVerified:true,burnInstructionVerified:true,
      programId,approvedHash:'a'.repeat(64)}}};
  const env={FUNDED_V3_BUYBACK_ENABLED:'true',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
    FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64)};
  const replies=[];
  const route=createRewardStatusRoutes({store:{read:async()=>state},automaticRewardStore:{read:async()=>rewards},
    solanaCluster:'devnet',solanaRpcUrl:'https://unused.invalid',env,now:()=>clock,
    connectionFactory:()=>({}),
    readProgramReadiness:async()=>({ready:programReady,programId,reasons:programReady?[]:['RPC unavailable.']}),
    readBuybackDashboard:async()=>({status:custodyReady?'verified':'unavailable',
      unindexedStatus:custodyReady?'verified':'unavailable',triggerReached:custodyReady,
      unindexedVaults:custodyReady?[{mint:programId,status:'verified',pendingLamports:'5000000'}]:[]}),
    respond:(_res,_status,data)=>replies.push(data)});
  const read=async path=>{await route({method:'GET'},{},new URL(`https://funded.vip${path}`));return replies.at(-1);};
  assert.equal((await read('/api/buyback/status')).executionReady,true);
  assert.equal((await read('/api/rewards/automatic')).routeReadiness.buyback.ready,true);
  programReady=false;clock+=15_001;
  let result=await read('/api/buyback/status');
  assert.equal(result.executionReady,false);assert.match(result.executionReasons.join(' '),/RPC unavailable/);
  assert.equal(result.historicalExecutionVerified,true);
  programReady=true;custodyReady=false;clock+=20_001;
  result=await read('/api/buyback/status');
  assert.equal(result.executionReady,false);assert.match(result.executionReasons.join(' '),/custody/);
  custodyReady=true;clock+=20_001;
  rewards.buybackWorkerHeartbeat={status:'failed',cluster:'devnet',at:new Date(clock).toISOString()};
  result=await read('/api/buyback/status');
  assert.equal(result.executionReady,false);assert.match(result.executionReasons.join(' '),/worker-not-ready/);
  rewards.buybackWorkerHeartbeat={status:'ready',cluster:'devnet',at:new Date(clock).toISOString()};
  result=await read('/api/buyback/status');
  assert.equal(result.executionReady,true);
  clock+=180_001;
  result=await read('/api/buyback/status');
  assert.equal(result.executionReady,false);assert.match(result.executionReasons.join(' '),/heartbeat-stale/);
});

test('only an authorized Devnet worker records a heartbeat that survives reward store reopening', async t => {
  const directory=await mkdtemp(join(tmpdir(),'funded-buyback-status-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'rewards.json'),ledger=createAutomaticRewardStore(path);
  let allowed=false,clock=Date.parse('2026-10-19T04:00:00Z');const replies=[];
  const route=createRewardStatusRoutes({automaticRewardStore:ledger,solanaCluster:'devnet',
    now:()=>clock,requireAuthorized:()=>allowed,
    respond:(_res,status,data)=>replies.push({status,data})});
  const request=()=>route({method:'POST'},{},new URL('https://funded.vip/api/buyback/worker-heartbeat?status=ready'));
  await request();assert.equal((await ledger.read()).buybackWorkerHeartbeat,undefined);
  allowed=true;await request();
  assert.equal(replies.at(-1).status,200);
  assert.deepEqual((await createAutomaticRewardStore(path).read()).buybackWorkerHeartbeat,
    {status:'ready',cluster:'devnet',at:new Date(clock).toISOString()});
});

test('verified older vaults become worker sources only while custody scan is complete', async () => {
  const mint='9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
  const dashboard={status:'verified',triggerReached:true,
    unindexedStatus:'verified',unindexedVaults:[{mint,status:'verified',
      pendingLamports:'5000000'}]};
  const state={v3Settlements:{},v3BuybackOrders:{}};
  const replies=[];
  const route=createRewardStatusRoutes({store:{read:async()=>state},
    solanaCluster:'devnet',solanaRpcUrl:'https://unused.invalid',
    env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},
    connectionFactory:()=>({}),readBuybackDashboard:async()=>dashboard,
    respond:(_res,status,data)=>replies.push({status,data})});
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(replies.at(-1).data.pending[0].sourceCollectionSignature,'onchain');
  assert.equal(replies.at(-1).data.pending[0].amountLamports,'5000000');
  dashboard.unindexedStatus='partial';
  dashboard.unindexedVaults=[];
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(replies.at(-1).data.pending.length,0);
  state.v3BuybackOrders[`onchain:${mint}`]={mint,programId,
    sourceKind:'onchain-policy',status:'verification-pending',signature:'3'.repeat(64)};
  await route({method:'GET'},{},new URL('https://funded.vip/api/buyback/status'));
  assert.equal(replies.at(-1).data.pending[0].status,'verification-pending');
});
