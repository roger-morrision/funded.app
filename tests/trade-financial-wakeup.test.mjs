import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {recordTradeWake,startTradeFinancialWakeWorker} from '../server/trade-financial-wakeup.mjs';
import {createTradeFinancialWakeRoutes} from '../server/routes/trade-financial-wakeup.mjs';
import {createTradeWakePoll} from '../scripts/trade-wake-poll.mjs';
const mint=Keypair.generate().publicKey.toBase58(),wallet=Keypair.generate().publicKey.toBase58();
const signature='4'.repeat(64),trade={mint,trader:wallet,signature,slot:100,finalized:true};
function ledger(){const state={};return {state,read:async()=>structuredClone(state),transaction:async fn=>fn(state)};}

test('trade revisions deduplicate notifications and survive worker restarts',async()=>{
  const store=ledger();assert.equal((await recordTradeWake(store,trade)).revision,1);
  assert.equal((await recordTradeWake(store,trade)).recorded,false);
  let calls=0,hold,entered;const gate=new Promise(r=>hold=r),started=new Promise(r=>entered=r);
  const w=startTradeFinancialWakeWorker({store,run:async()=>{calls++;entered();await gate;},scheduleInterval:()=>({unref(){}})});
  await started;await recordTradeWake(store,{...trade,signature:'5'.repeat(64)});
  hold();await new Promise(r=>setImmediate(r));await w.tick();assert.equal(calls,2);
  await w.tick();assert.equal(calls,2);
});

test('worker wake revisions retain periodic recovery and coalesce trade bursts',async()=>{
  let clock=1000,revision=0;const poll=createTradeWakePoll({intervalMs:60000,now:()=>clock});
  const read=async()=>({cluster:'devnet',revision});
  assert.equal(await poll(read),true);assert.equal(await poll(read),false);
  revision+=8;assert.equal(await poll(read),true);assert.equal(await poll(read),false);
  clock+=60000;assert.equal(await poll(read),true);
});

test('public notification requires origin, verified V3 launch and independently finalized matching trade',async()=>{
  const rewards=ledger();let checks=0,response;
  const store={read:async()=>({launches:{[mint]:{onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3'}}}}),chargeRpcRate:async()=>true};
  const handle=createTradeFinancialWakeRoutes({store,rewardStore:rewards,solanaCluster:'devnet',solanaRpcUrl:'unused',
    body:async()=>({mint,wallet,signature}),clientKey:()=> 'test',requireAuthorized:()=>false,
    env:{CORS_ORIGIN:'https://test.example'},connectionFactory:()=>({}),
    verify:async()=>{checks++;return trade;},respond:(_res,status,data)=>{response={status,data};}});
  const url=new URL('https://test.example/api/trades/finalized');
  await handle({method:'POST',headers:{origin:'https://evil.example'}},{},url);assert.equal(response.status,403);assert.equal(checks,0);
  await handle({method:'POST',headers:{origin:'https://test.example'}},{},url);assert.equal(response.status,202);assert.equal(response.data.atomicWithTrade,false);
  await handle({method:'POST',headers:{origin:'https://test.example'}},{},url);assert.equal(response.data.recorded,false);assert.equal(rewards.state.tradeFinancialWake.revision,1);
});

test('a mismatched verifier result cannot enqueue financial work',async()=>{
  const rewards=ledger();let status;
  const handle=createTradeFinancialWakeRoutes({store:{chargeRpcRate:async()=>true,read:async()=>({launches:{[mint]:{onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3'}}}})},
    rewardStore:rewards,solanaCluster:'devnet',env:{CORS_ORIGIN:'https://test.example'},clientKey:()=>'',body:async()=>({mint,wallet,signature}),
    connectionFactory:()=>({}),verify:async()=>({...trade,finalized:false}),respond:(_r,s)=>{status=s;}});
  await handle({method:'POST',headers:{origin:'https://test.example'}},{},new URL('https://test.example/api/trades/finalized'));
  assert.equal(status,409);assert.equal(rewards.state.tradeFinancialWake,undefined);
});
