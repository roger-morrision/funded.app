import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {recordTop100Snapshot,top100Growth} from '../server/top100-growth.mjs';
import {top100CommunityCounts} from '../server/top100-community.mjs';
import {createDirectoryRoutes} from '../server/routes/directory.mjs';
import {top100Records} from '../src/features/explore/top100-model.js';
const mint='A'.repeat(32), now=Date.now(), day=86400000;

test('growth history persists across restarts, keeps losses, and expires stale or absent baselines', async()=>{
  const folder=await mkdtemp(join(tmpdir(),'funded-top100-'));
  try {
    const file=join(folder,'state.json'), store=createStore(file,null);
    await recordTop100Snapshot(store,'devnet',mint,'marketCapUsd',100,now-day);
    await recordTop100Snapshot(store,'devnet',mint,'holders',10,now-day);
    await recordTop100Snapshot(store,'devnet',mint,'marketCapUsd',60,now);
    await recordTop100Snapshot(store,'devnet',mint,'holders',7,now);
    const state=await createStore(file,null).read();
    const result=top100Growth(state.top100Snapshots,'devnet',now);
    assert.equal(result.items[mint].marketCapUsd.delta,-40);
    assert.equal(result.items[mint].holders.delta,-3);
    assert.deepEqual(top100Growth(state.top100Snapshots,'mainnet-beta',now).items,{});
    assert.equal(top100Growth(state.top100Snapshots,'devnet',now+300001).items[mint].holders,null);
    const gap=structuredClone(state.top100Snapshots);
    gap[`devnet:${mint}`].holders[0].at=now-day-600001;
    assert.equal(top100Growth(gap,'devnet',now).items[mint].holders,null);
    await recordTop100Snapshot(store,'devnet',mint,'holders',-1,now+1);
    assert.equal((await store.read()).top100Snapshots[`devnet:${mint}`].holdersLatest.value,7);
  } finally {await rm(folder,{recursive:true,force:true});}
});

test('snapshot sampling stays bounded and never creates an opening value from the first observation',async()=>{
  const state={},store={update:async fn=>fn(state)};
  for(let i=0;i<1800;i++)await recordTop100Snapshot(store,'devnet',mint,'holders',i,now-1800*60000+i*60000);
  const saved=state.top100Snapshots[`devnet:${mint}`];
  assert.ok(saved.holders.length<=314);assert.equal(saved.holdersLatest.value,1799);
  const empty={};await recordTop100Snapshot({update:async fn=>fn(empty)},'devnet',mint,'holders',42,now);
  assert.equal(top100Growth(empty.top100Snapshots,'devnet',now).items[mint].holders,null);
});

test('24h calls/chat excludes old, future, hidden and duplicate posts; a call is counted once',()=>{
  const row=(id,at=now,extra={})=>({id,mint,createdAt:new Date(at).toISOString(),author:'private',text:'private',...extra});
  const result=top100CommunityCounts({[mint]:[row('a',now,{callout:{}}),row('a'),row('b'),row('old',now-day-1),row('future',now+1),row('hidden',now,{status:'hidden'}),row('deleted',now,{status:'deleted'}),row('wrong',now,{mint:'B'.repeat(32)})]},now);
  assert.deepEqual(result.items[mint],{calls:1,chats:1,total:2});
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.deepEqual(top100CommunityCounts(null,now).items,{});
});

test('metrics route coalesces reads and exposes counts only; client rejects malformed or stale counts',async()=>{
  let reads=0;
  const handler=createDirectoryRoutes({solanaCluster:'devnet',store:{read:async()=>{reads++;return {coinChats:{[mint]:[{id:'1',mint,createdAt:new Date(now).toISOString(),author:'private',text:'private'}]}};}},respond:(res,status,data)=>Object.assign(res,{status,data})});
  const responses=[{},{}];
  await Promise.all(responses.map(res=>handler({method:'GET'},res,new URL('http://test/api/top100/metrics'))));
  assert.equal(reads,1);assert.equal(responses[0].status,200);
  assert.equal(top100Records([{address:mint}],{community:responses[0].data,now:Date.now()})[0].communityCount,1);
  assert.ok(!JSON.stringify(responses[0]).includes('private'));
  for(const patch of [{items:null},{items:[]},{observedAt:now-300001},{cluster:'mainnet-beta'}])
    assert.equal(top100Records([{address:mint}],{community:{...responses[0].data,...patch},now:Date.now()})[0].communityCount,null);
});


test('token-account route records distinct wallet owners only from complete server samples',async()=>{
  const {Keypair,PublicKey}=await import('@solana/web3.js');
  const {TOKEN_PROGRAM_ID}=await import('@solana/spl-token');
  const {createTokenMarketRoutes}=await import('../server/routes/token-market.mjs');
  const token=Keypair.generate().publicKey, owner=Keypair.generate().publicKey;
  const vault=PublicKey.findProgramAddressSync([Buffer.from('test')],TOKEN_PROGRAM_ID)[0];
  for(const partial of [false,true]) {
    const state={}, accounts=Array.from({length:partial?20:3},(_,i)=>({address:Keypair.generate().publicKey,amount:'1',decimals:0,owner:i===2?vault:owner}));
    const connection={getTokenLargestAccounts:async()=>({value:accounts}),getMultipleAccountsInfo:async()=>accounts.map(row=>{
      const data=Buffer.alloc(165);token.toBuffer().copy(data,0);row.owner.toBuffer().copy(data,32);data.writeBigUInt64LE(1n,64);data[108]=1;
      return {owner:TOKEN_PROGRAM_ID,data};
    }),getAccountInfo:async()=>({owner:TOKEN_PROGRAM_ID}),getProgramAccounts:async()=>{throw Error('index unavailable');}};
    const handler=createTokenMarketRoutes({solanaCluster:'devnet',solanaRpcUrl:'http://unused',makeTokenConnection:()=>connection,
      store:{chargeRpcRate:async()=>true,update:async fn=>fn(state)},clientKey:()=> 'test',route:(path,method,pattern)=>pattern.exec(path)?.[1],respond:(res,status,data)=>Object.assign(res,{status,data})});
    const res={};await handler({method:'GET'},res,new URL(`http://test/api/tokens/${token}/token-accounts`));
    assert.equal(res.status,200);
    assert.equal(state.top100Snapshots?.[`devnet:${token}`]?.holdersLatest.value,partial?undefined:1);
  }
});
