import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicReadFetch} from '../src/lib/public-read-fetch.js';
import {createRoutePoller} from '../route-polling.js';
import {coinReferralSummary} from '../src/features/coin/referral-summary.js';
import {buildCoinSummary} from '../coin-summary-model.js';
import {createExploreRegistryController} from '../src/app/controllers/explore-registry.js';
import {fundedSpotUsd} from '../src/features/funded/spot-price.js';

test('Home burn values use the verified FUNDED pool even outside the launch directory',()=>{
  const input={mint:'funded',route:{status:'ready',snapshot:{mint:'funded',spotPriceSol:0.002}},solUsd:100};
  assert.equal(fundedSpotUsd(input),0.2);
  assert.equal(fundedSpotUsd({...input,mint:'other'}),null);
  assert.equal(fundedSpotUsd({...input,solUsd:NaN}),null);
  assert.equal(fundedSpotUsd({...input,route:{status:'unavailable'}}),null);
});

const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
test('public GETs recover one transient failure in a shared flight, with a hard retry limit',async()=>{
  for(const failure of [()=>new Response('upstream',{status:502}),()=>{throw new TypeError('Failed to fetch');}]){
    let calls=0;
    const read=createPublicReadFetch(async()=>++calls===1?failure():Response.json({count:10}),{retryDelayMs:0});
    const [a,b]=await Promise.all([read('/api/launches'),read('/api/launches')]);
    assert.equal(calls,2);assert.deepEqual(await a.json(),{count:10});assert.deepEqual(await b.json(),{count:10});
  }
  let calls=0;
  const read=createPublicReadFetch(async()=>{calls++;return new Response(null,{status:503});},{retryDelayMs:0});
  assert.equal((await read('/api/launches')).status,503);assert.equal(calls,2);
});

test('no automatic replay of writes, private reads, client errors or long rate-limit waits',async()=>{
  for(const [path,options,status,headers] of [
    ['/api/launches',{method:'POST',body:'{}'},503,{}],
    ['/api/launches',{headers:{authorization:'test'}},503,{}],
    ['/api/rewards/experience?wallet=test',{},503,{}],
    ['/api/launches',{},403,{}],['/api/launches',{},429,{'retry-after':'60'}],
  ]){
    let calls=0;const read=createPublicReadFetch(async()=>{calls++;return new Response(null,{status,headers});},{retryDelayMs:0});
    assert.equal((await read(path,options)).status,status);assert.equal(calls,1);
  }
});

test('stalled reads time out and release their flight so a later refresh succeeds',async()=>{
  let calls=0;
  const read=createPublicReadFetch(async(_url,{signal})=>{
    if(++calls>1)return Response.json({ok:true});
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  },{timeoutMs:10,retryDelayMs:0});
  await assert.rejects(read('/api/launches'),{name:'TimeoutError'});
  assert.equal((await read('/api/launches')).ok,true);assert.equal(calls,2);
});

test('reconnect refreshes only visible active pages and queues behind an in-flight refresh',async()=>{
  const window=new EventTarget(),document=new EventTarget();document.hidden=false;
  let active=true,calls=0,release;
  const poller=createRoutePoller({window,document,active:()=>active,intervalMs:60000,
    run:async()=>{calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});}});
  try{
    window.dispatchEvent(new Event('online'));await tick();assert.equal(calls,1);
    window.dispatchEvent(new Event('online'));await tick();assert.equal(calls,1);
    release();await tick();assert.equal(calls,2);
    active=false;window.dispatchEvent(new Event('online'));await tick();assert.equal(calls,2);
    active=true;document.hidden=true;window.dispatchEvent(new Event('online'));await tick();assert.equal(calls,2);
  }finally{poller.stop();}
  document.hidden=false;window.dispatchEvent(new Event('online'));await tick();assert.equal(calls,2);
});

const history={cluster:'devnet',commitment:'finalized',status:'onchain-indexed',payoutCoverage:{status:'verified'},
  verifiedPayouts:[{source:'v3-referral',mint:'mint',signature:'2'.repeat(64),amountLamports:469,actualReceivedLamports:469},
    {source:'v3-creator-wallet',mint:'mint',signature:'3'.repeat(64),amountLamports:100,actualReceivedLamports:100}]};
test('token referral totals use finalized recipient amounts and never infer zero from missing coverage',()=>{
  assert.deepEqual(coinReferralSummary(history,'mint','devnet'),{amountLamports:'469',count:1,partial:false});
  assert.equal(coinReferralSummary(history,'other','devnet').amountLamports,'0');
  for(const invalid of [undefined,{...history,cluster:'mainnet-beta'},{...history,commitment:'confirmed'},{...history,payoutCoverage:{status:'unavailable'}}])
    assert.equal(coinReferralSummary(invalid,'mint','devnet').amountLamports,null);
  assert.equal(coinReferralSummary({...history,status:'partial',verifiedPayouts:[]},'mint','devnet').amountLamports,null);
  assert.equal(coinReferralSummary({...history,verifiedPayouts:[...history.verifiedPayouts,history.verifiedPayouts[0]]},'mint','devnet').amountLamports,'469');
  const summary=buildCoinSummary({mint:'mint',cluster:'devnet',launch:{mint:'mint',cluster:'devnet',onchainVerified:true,pumpFeeRoute:{scope:'per-mint-v3'}},solUsd:100,paymentHistoryEvidence:history});
  const card=summary.cards.find(x=>x.id==='referrals');assert.ok(Math.abs(card.amount-0.0000469)<1e-15);assert.match(card.note,/1 confirmed payment/);
});

test('analytics and collection results render independently of slow payment history',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const summary={cluster:'devnet',homeFeeAllocations:{cluster:'devnet',status:'verified'}};
  const state={EXPLORE_CLUSTER:'devnet',assets:[],apiRequest:async path=>path.endsWith('payment-history')?pending:
    {available:true,data:path.endsWith('summary')?summary:{cluster:'devnet',status:'onchain-indexed'}},
    renderExplorePayoutStats(){},renderOnchainReportState(){},renderHomeKpiDashboard(){this.rendered=this.analyticsSummary;},renderVerifiedReceiptEvidence(){}};
  const flight=createExploreRegistryController(state).loadReceiptEvidence();await tick();
  assert.equal(state.rendered,summary);assert.equal(state.receiptEvidenceChecked,true);assert.equal(state.receiptEvidenceLoading,true);
  finish(null);await flight;assert.equal(state.receiptEvidenceLoading,false);
});
