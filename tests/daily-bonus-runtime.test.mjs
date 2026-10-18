import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyBonusRuntime } from '../server/daily-bonus-runtime.mjs';
const at = day => Date.parse(`${day}T00:00:00Z`) / 1000;
function setup({enabled=true}={}) {
  const ledger = {}, calls = [];
  const rewardStore = {read:async()=>structuredClone(ledger),transaction:async fn=>fn(ledger)};
  const store = {read:async()=>({launches:{mint:{cluster:'devnet',onchainVerified:true,createdTimestamp:at('2026-10-10'),
    feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}}}})};
  let capture = async day => {
    calls.push(['capture',day]);
    if(day==='2026-10-10') throw new Error('RPC unavailable for one day.');
    ledger.dailyBonusSnapshots ||= {};
    ledger.dailyBonusSnapshots[day] = {status:'snapshotted',evidenceCoverageVersion:1,snapshot:{sources:[{collectionSignature:day,allocations:[{}]}]}};
    return {status:'snapshotted'};
  };
  const runtime = createDailyBonusRuntime({store,rewardStore,solanaCluster:'devnet',solanaRpcUrl:'http://127.0.0.1:1',
    v3AuthorityKeypair:()=>({}),now:()=>at('2026-10-15'),env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:'configured',
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),FUNDED_DAILY_BONUS_PAYOUT_ENABLED:String(enabled)},
    serviceFactory:()=>({capture:day=>capture(day),execute:async day=>{
      calls.push(['execute',day]); if(day==='2026-10-11')throw new Error('One source awaits funding.');
    },reconcile:async(day,input)=>{calls.push(['reconcile',day,input]);return{};},status:async()=>({snapshots:[]})})});
  return {runtime,ledger,calls,setCapture:fn=>{capture=fn;}};
}
test('catch-up isolates failed days and continues capture and older payout queues fairly',async()=>{
  const f=setup(); await f.runtime.tick();
  assert.deepEqual(f.calls,[['capture','2026-10-10'],['capture','2026-10-11'],['capture','2026-10-12'],['execute','2026-10-11'],['execute','2026-10-12']]);
  assert.equal(f.ledger.dailyBonusServiceStatus.status,'degraded');
  f.calls.length=0;await f.runtime.tick();
  assert.deepEqual(f.calls.slice(0,3),[['capture','2026-10-13'],['capture','2026-10-14'],['capture','2026-10-10']]);
});
test('disabled payouts never execute; external waits do not request rapid retries',async()=>{
  const f=setup({enabled:false});
  f.setCapture(async()=>({status:'indexing',reason:'Waiting for a finalized settlement.',progress:{completedRoutes:3,routes:3}}));
  assert.equal(await f.runtime.tick(),false);assert.equal(f.calls.length,0);
  f.setCapture(async()=>({status:'indexing',progress:{completedRoutes:2,routes:3}}));
  assert.equal(await f.runtime.tick(),true);
});
test('reconciliation internal token handler requires authorization and fixes audit identity',async()=>{
  const f=setup();let response;
  const deps={body:async()=>({day:'2026-10-10',actor:'forged'}),respond:(_,status,value)=>{response={status,value};},requireAuthorized:()=>false};
  const req={method:'POST'},res={setHeader(){}};const url=new URL('https://funded.vip/api/daily-bonus/reconcile');
  await f.runtime.handle(req,res,url,deps);assert.equal(f.calls.length,0);
  deps.requireAuthorized=()=>true;await f.runtime.handle(req,res,url,deps);
  assert.equal(response.status,200);assert.equal(f.calls[0][2].actor,'api-token');
});
