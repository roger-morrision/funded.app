import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createAnalyticsSummaryReader } from '../server/analytics-summary-reader.mjs';
import { createPublicReportsRoutes } from '../server/routes/public-reports.mjs';

// Exact pre-change route snapshot from accepted cd950e5. Kept inline so the
// compatibility controls also run in immutable images without Git installed.
const baselineSource = String.raw`import { CREATOR_SUPPORT_VERSION } from '../../creator-support-model.js';
import { homeFeeAllocationSummary } from '../home-dashboard-metrics.mjs';
import { creatorReputation } from '../../stonk-features.js';
import { v3PublicMetrics, v3ReceiptEvidence } from '../v3-public-metrics.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createPublicReportsRoutes({
  publicState, store, readReceiptEvidence, readPaymentHistory, automaticRewardStore, readFinalizedEvidence, solanaCluster, databaseUrl,
  respond,
}) {

  const json = (...args) => { respond(...args); return true; };
  return async function handlePublicReportsRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(await store.readPublicBuckets()));
    if (req.method === 'GET' && url.pathname === '/api/evidence/receipts') {
      const [state, evidence] = await Promise.all([store.read(), readFinalizedEvidence()]);
      return json(res, 200, v3ReceiptEvidence(state, evidence, solanaCluster));
    }
    if (req.method === 'GET' && url.pathname === '/api/evidence/payment-history') return json(res, 200, await readPaymentHistory());
    if (req.method === 'GET' && url.pathname === '/api/analytics/summary') {
      const [state, rewards, evidence, history] = await Promise.all([store.read(), automaticRewardStore.read(), readFinalizedEvidence(), readPaymentHistory()]);
      const launches = Object.values(state.launches || {}).filter(row => row.cluster === solanaCluster
        && row.onchainVerified === true && row.pumpFeeRoute?.scope === 'per-mint-v3');
      const { v3Evidence, ...totals } = v3PublicMetrics(state, evidence, history, rewards, solanaCluster);
      return json(res, 200, {
        cluster: solanaCluster,
        build: process.env.FUNDED_BUILD_ID || CREATOR_SUPPORT_VERSION,
        source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger',
        generatedAt: new Date().toISOString(),
        freshness: evidence.generatedAt || null,
        launches: launches.length,
        ...totals,
        homeFeeAllocations: homeFeeAllocationSummary(state, v3Evidence, solanaCluster),
        creatorProfiles: creatorReputation(launches).length,
      });
    }
    return false;
  };
}
`;
assert.equal(createHash('sha256').update(baselineSource).digest('hex'),'7fa16f9ec8381b73f16059301adcc8e7151942a1f3b4066576682fda1fa907c0');
const baselineUrl = new URL('../server/routes/public-reports.mjs',import.meta.url);
const baselineModule = baselineSource.replace(/from '([^']+)'/g,(_match,path)=>`from '${new URL(path,baselineUrl).href}'`);
const { createPublicReportsRoutes: baselineRoutes } = await import(`data:text/javascript,${encodeURIComponent(baselineModule)}`);
const unavailable = {available:false};
const errorBody = {status:'unavailable',retryable:true,error:'Analytics is temporarily unavailable. Please try again shortly.'};
const deferred = () => { let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<10;i++)await Promise.resolve(); };

function fixture(kind='empty') {
  const mint='1'.repeat(32), wallet='3'.repeat(32);
  const state={launches:{},collections:{},v3Settlements:{}};
  const evidence={cluster:'devnet',commitment:'finalized',status:'no-records',generatedAt:'2026-10-21T00:00:00.000Z',verifiedCollections:[]};
  const history={cluster:'devnet',commitment:'finalized',status:'onchain-indexed',generatedAt:evidence.generatedAt,verifiedPayouts:[],
    payoutCoverage:{scope:'v3-sol-recipient-receipts',status:'verified',recorded:0,verified:0,verifiedTotalLamports:'0'}};
  if(kind!=='empty') {
    state.launches[mint]={mint,creatorWallet:wallet,cluster:'devnet',onchainVerified:true,pumpFeeRoute:{scope:'per-mint-v3'}};
    for(let i=0;i<2;i++) {
      const signature=String(i+4).repeat(64), amount=kind==='overflow'?String(Number.MAX_SAFE_INTEGER):'1000';
      state.collections[signature]={signature,mint,scope:'per-mint-v3',cluster:'devnet',status:'collected',onchainVerified:true,collectedLamports:amount};
      state.v3Settlements[signature]={status:'finalized',allocationPlan:{status:'allocated-not-funded',protocol:{buybackLamports:'50'}}};
      evidence.verifiedCollections.push({signature,mint,collectedLamports:amount});
    }
    evidence.status='onchain-indexed';
    history.verifiedPayouts=[{source:'automatic-holder',to:wallet,amountLamports:'50'},
      {source:'v3-creator-wallet',to:wallet,amountLamports:'30'},
      {source:'daily-bonus',to:wallet,amountLamports:'20'}];
    history.payoutCoverage={...history.payoutCoverage,recorded:3,verified:3,verifiedTotalLamports:'100'};
    if(kind==='partial') {evidence.status='partial';evidence.verifiedCollections.pop();history.status='partial';history.payoutCoverage.status='partial';}
    if(kind==='unavailable') {evidence.status='unavailable';evidence.verifiedCollections=[];history.status='unavailable';history.verifiedPayouts=[];delete history.payoutCoverage;}
  }
  return [state,{},evidence,history];
}
function route(reads, factory=createPublicReportsRoutes, responses=[]) {
  const handle=factory({store:{read:reads[0]},automaticRewardStore:{read:reads[1]},
    readFinalizedEvidence:reads[2],readPaymentHistory:reads[3],solanaCluster:'devnet',databaseUrl:'fixture-configured',
    respond:(res,status,data)=>{res.responses++;res.status=status;res.data=data;responses.push({status,data});}});
  return {handle,responses,request:async(path='/api/analytics/summary',method='GET')=>{
    const res={responses:0};res.handled=await handle({method},res,new URL(path,'https://fixture.invalid'));return res;
  }};
}

test('fixed dependency snapshot and instance isolation never share loads or accept a malformed reader list', async()=>{
  assert.throws(()=>createAnalyticsSummaryReader([]),/four/);
  assert.throws(()=>createAnalyticsSummaryReader([()=>1,()=>2,()=>3,null]),/four/);
  const a=[()=>1,()=>2,()=>3,()=>4], readA=createAnalyticsSummaryReader(a), readB=createAnalyticsSummaryReader(a.map(f=>()=>f()+10));
  a[0]=()=>99;
  assert.deepEqual((await readA()).values,[1,2,3,4]);assert.deepEqual((await readB()).values,[11,12,13,14]);
});

for(let held=0;held<4;held++)test(`actual summary route replies once at6000ms when dependency${held} stays pending`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=deferred(), values=fixture(), reads=values.map((value,index)=>()=>index===held?pending.promise:value);
  const subject=route(reads);let done=false;
  const response=subject.request().then(value=>{done=true;return value;});await flush();
  t.mock.timers.tick(5999);await flush();assert.equal(done,false);
  t.mock.timers.tick(1);const result=await response;
  assert.equal(result.status,503);assert.deepEqual(result.data,errorBody);assert.equal(result.responses,1);
  pending.resolve(values[held]);await flush();assert.equal(subject.responses.length,1);
  assert.equal((await subject.request()).status,200);
});

test('all inputs settling at5999ms preserve success and clear the deadline; later requests start fresh joins',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const held=deferred();let reads=0;
  const read=createAnalyticsSummaryReader([()=>{reads++;return held.promise;},()=>2,()=>3,()=>4]);
  const first=read();await flush();t.mock.timers.tick(5999);held.resolve(1);
  const result=await first;assert.deepEqual(result,{available:true,values:[1,2,3,4]});
  t.mock.timers.tick(60_000);await flush();assert.deepEqual(await first,result);
  assert.deepEqual(await read(),result);assert.equal(reads,2);
});

test('twenty concurrent requests share one join and one read of each dependency',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const pending=deferred(), calls=[0,0,0,0];
  const read=createAnalyticsSummaryReader(calls.map((_,i)=>()=>{calls[i]++;return pending.promise;}));
  const first=read(), others=Array.from({length:19},()=>read());assert(others.every(p=>p===first));await flush();
  assert.deepEqual(calls,[1,1,1,1]);t.mock.timers.tick(6000);
  assert((await Promise.all([first,...others])).every(value=>value.available===false));
  pending.resolve('late');await flush();
});

test('twenty actual route subscribers share inputs, each receive one503, and recover without late extra responses',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const pending=deferred(), calls=[0,0,0,0], values=fixture();
  const subject=route(values.map((value,index)=>()=>{calls[index]++;return index===2?pending.promise:value;}));
  const responses=Array.from({length:20},()=>subject.request());await flush();assert.deepEqual(calls,[1,1,1,1]);
  t.mock.timers.tick(6000);
  for(const response of await Promise.all(responses)){assert.equal(response.responses,1);assert.equal(response.status,503);assert.deepEqual(response.data,errorBody);}
  pending.resolve(values[2]);await flush();assert.equal(subject.responses.length,20);
  const recovered=await subject.request();assert.equal(recovered.status,200);assert.equal(recovered.responses,1);
  assert.deepEqual(calls,[2,2,2,2]);assert.equal(subject.responses.length,21);
});

for(const synchronous of [false,true])test(`early ${synchronous?'synchronous throw':'rejection'} retains every started sibling in the two-load cap`,async()=>{
  let healthy=false;const calls=[0,0,0,0], held=Array.from({length:2},()=>Array.from({length:4},deferred));
  const read=createAnalyticsSummaryReader(calls.map((_,index)=>()=>{
    const generation=calls[index]++;
    if(healthy)return {generation,index};
    if(index===0){if(synchronous)throw Error('fixture private diagnostic');return Promise.reject(Error('fixture private diagnostic'));}
    return held[generation][index].promise;
  }));
  assert.deepEqual(await read(),unavailable);assert.deepEqual(await read(),unavailable);
  assert.deepEqual(calls,[2,2,2,2]);
  for(let i=0;i<20;i++)assert.deepEqual(await read(),unavailable);
  assert.deepEqual(calls,[2,2,2,2]);
  held[0][1].resolve('one sibling only');await flush();assert.deepEqual(await read(),unavailable);
  assert.deepEqual(calls,[2,2,2,2]);
  for(let i=2;i<4;i++)held[0][i].resolve('retired');await flush();healthy=true;
  assert.equal((await read()).available,true);assert.deepEqual(calls,[3,3,3,3]);
  for(let i=1;i<4;i++)held[1][i].resolve('retired');await flush();
});

test('two timed-out raw loads prevent a third; full settlement frees capacity and late failure cannot overwrite newer replies',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let healthy=false;
  const calls=[0,0,0,0], held=Array.from({length:2},()=>Array.from({length:4},deferred));
  const read=createAnalyticsSummaryReader(calls.map((_,index)=>()=>{
    const generation=calls[index]++;return healthy?{generation,index}:held[generation][index].promise;
  }));
  const first=read();await flush();t.mock.timers.tick(6000);assert.deepEqual(await first,unavailable);
  const second=read();await flush();assert.equal(read(),second);t.mock.timers.tick(6000);assert.deepEqual(await second,unavailable);
  for(let i=0;i<20;i++)assert.deepEqual(await read(),unavailable);assert.deepEqual(calls,[2,2,2,2]);
  held[0][0].resolve('partial settlement');await flush();assert.deepEqual(await read(),unavailable);
  for(let i=1;i<4;i++)held[0][i].resolve('late first');await flush();healthy=true;
  const fresh=await read();assert.equal(fresh.values[0].generation,2);
  held[1][0].reject(Error('late private rejection'));for(let i=1;i<4;i++)held[1][i].resolve('late second');await flush();
  assert.equal((await read()).values[0].generation,3);assert.equal(fresh.values[0].generation,2);
});

test('first timeout permits one healthy replacement while the original raw load remains pending',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const pending=deferred();let count=0;
  const read=createAnalyticsSummaryReader([()=>++count===1?pending.promise:'healthy',()=>2,()=>3,()=>4]);
  const first=read();await flush();t.mock.timers.tick(6000);assert.deepEqual(await first,unavailable);
  assert.equal((await read()).values[0],'healthy');pending.reject(Error('retired failure'));await flush();
  assert.deepEqual(await first,unavailable);
});

for(const kind of ['empty','complete','partial','overflow','unavailable'])test(`successful ${kind} response matches the exact historical route payload`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-21T00:00:00.000Z')});
  const values=fixture(kind), reads=values.map(value=>()=>structuredClone(value));
  const baseline=await route(reads,baselineRoutes).request(), candidate=await route(reads).request();
  assert.deepEqual(candidate,baseline);assert.equal(candidate.status,200);
  if(kind==='overflow')assert.equal(candidate.data.precisionStatus,'overflow');
});

test('rejected or throwing inputs produce only a sanitized retryable503 and unrelated routes do not start the join',async()=>{
  for(const synchronous of [false,true]){
    let calls=0;const reads=[()=>{calls++;if(synchronous)throw Error('fixture private diagnostic');return Promise.reject(Error('fixture private diagnostic'));},...fixture().slice(1).map(value=>()=>value)];
    const subject=route(reads);
    for(const [path,method] of [['/api/unknown','GET'],['/api/analytics/summary','POST']])assert.equal((await subject.request(path,method)).handled,false);
    assert.equal(calls,0);const response=await subject.request();assert.equal(response.status,503);assert.deepEqual(response.data,errorBody);
    assert(!JSON.stringify(response).includes('fixture private diagnostic'));assert.equal(calls,1);
  }
});

test('isolated real HTTP transport sends one sanitized503 within6500ms without waiting for held proof', {timeout:8000},async()=>{
  const hold=deferred(), values=fixture();
  const subject=route(values.map((value,i)=>()=>i===2?hold.promise:value));
  const server=http.createServer((req,res)=>{
    const output={responses:0};
    void subject.handle(req,output,new URL(req.url,'http://fixture.invalid')).then(()=>{
      res.writeHead(output.status,{'content-type':'application/json'});res.end(JSON.stringify(output.data));
    }).catch(()=>{res.writeHead(500);res.end();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const start=performance.now();const response=await fetch(`http://127.0.0.1:${server.address().port}/api/analytics/summary`,{signal:AbortSignal.timeout(6500)});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),errorBody);assert(performance.now()-start<6500);
    hold.resolve(values[2]);await flush();assert.equal(subject.responses.length,1);
  }finally{hold.resolve(values[2]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
