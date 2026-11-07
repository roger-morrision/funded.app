import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicReadFetch } from '../src/lib/public-read-fetch.js';
import { tokenArtworkUrl } from '../src/features/shared/token-artwork.js';
import { createTokenMarketRoutes } from '../server/routes/token-market.mjs';
import { createDirectoryRoutes } from '../server/routes/directory.mjs';
import { createAirdropsRoutes } from '../server/routes/airdrops.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { readCommunityReserveStatus } from '../server/community-reserve-status.mjs';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const mint='Ganx3kyKmCfgaBsxYTp8X52pTfi9L5dm8BQAmFuvEEEZ';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('simultaneous public reads share transport but retain independent response bodies',async()=>{
  const wait=deferred();let calls=0;
  const read=createPublicReadFetch(async()=>{calls++;await wait.promise;return Response.json({value:42});});
  const a=read('/api/launches'),b=read('/api/launches',{cache:'no-store'});
  await tick();assert.equal(calls,1);wait.resolve();
  assert.deepEqual(await (await a).json(),{value:42});assert.deepEqual(await (await b).json(),{value:42});
  await read('/api/launches');assert.equal(calls,2,'later refresh is not cached');
});

test('one caller aborting does not cancel another; all callers aborting cancels transport',async()=>{
  const wait=deferred();let upstream;
  const read=createPublicReadFetch(async(_url,options)=>{upstream=options.signal;await wait.promise;return Response.json({ok:true});});
  const controller=new AbortController();
  const a=read('/api/airdrops/reserves',{signal:controller.signal}),b=read('/api/airdrops/reserves');
  await tick();controller.abort();await assert.rejects(a,{name:'AbortError'});assert.equal(upstream.aborted,false);
  wait.resolve();assert.equal((await b).ok,true);
  const second=new AbortController();const c=read('/api/launches',{signal:second.signal});await tick();
  // A fresh already completed read has no remaining work to cancel.
  await c;
  const stalled=deferred();let pendingSignal;
  const pending=createPublicReadFetch(async(_url,o)=>{pendingSignal=o.signal;await stalled.promise;return Response.json({});});
  const only=pending('/api/launches',{signal:second.signal});await tick();second.abort();
  await assert.rejects(only,{name:'AbortError'});assert.equal(pendingSignal.aborted,true);stalled.resolve();
});

test('writes, authenticated reads and wallet-scoped responses are never shared',async()=>{
  let calls=0;const read=createPublicReadFetch(async()=>{calls++;return Response.json({});});
  for(const [url,options] of [['/api/launches',{method:'POST',body:'{}'}],['/api/launches',{headers:{authorization:'test'}}],['/api/rewards/experience?wallet='+mint,{}],['/api/private',{}]]) {
    const before=calls;await Promise.all([read(url,options),read(url,options)]);assert.equal(calls-before,2);
  }
});

test('failed shared reads can retry without retaining rejected promises',async()=>{
  let calls=0;const read=createPublicReadFetch(async()=>{if(++calls===1)throw Error('offline');return Response.json({ok:true});});
  const result=await Promise.allSettled([read('/api/launches'),read('/api/launches')]);
  assert.ok(result.every(row=>row.status==='rejected'));assert.equal(calls,1);
  assert.equal((await read('/api/launches')).ok,true);assert.equal(calls,2);
});

test('signed artwork uses app delivery without changing external or Mainnet URLs',()=>{
  const uri='https://gateway.pinata.cloud/ipfs/bafkreidi4gyokdg3gchw3qui2dadvepyouwexspms2aryitjzrfqf6whca';
  assert.equal(tokenArtworkUrl(mint,uri),'/devnet-images/'+mint);
  assert.equal(tokenArtworkUrl(mint,uri,'banner'),'/devnet-banners/'+mint);
  assert.equal(tokenArtworkUrl(mint,uri,'image','mainnet-beta'),uri);
  assert.equal(tokenArtworkUrl(mint,'https://example.com/avatar.png'),'https://example.com/avatar.png');
});

const respond=(res,status,data)=>Object.assign(res,{status,data});
test('concurrent holder lookups share a provider scan and retain verified coverage',async()=>{
  let scans=0;const wait=deferred();
  const handle=createTokenMarketRoutes({route:(path,_method,regex)=>regex.exec(path)?.[1],store:{chargeRpcRate:async()=>true},clientKey:()=> 'test',solanaCluster:'devnet',solanaRpcUrl:'unused',respond,
    makeTokenConnection:()=>({getTokenLargestAccounts:async()=>{scans++;await wait.promise;return {value:[]};}})});
  const a={},b={};const url=new URL('https://test/api/tokens/'+mint+'/token-accounts');
  const first=handle({method:'GET'},a,url),second=handle({method:'GET'},b,url);await tick();assert.equal(scans,1);wait.resolve();await Promise.all([first,second]);
  assert.equal(a.status,200);assert.deepEqual(a.data,b.data);assert.equal(a.data.coverage,'complete-account-list');
});

test('public token config does not fetch pool prices or read the database',async()=>{
  const handle=createDirectoryRoutes({solanaCluster:'devnet',fundedTokenMint:mint,respond});const res={};
  await handle({method:'GET'},res,new URL('https://test/api/token-config'));
  assert.equal(res.status,200);assert.deepEqual(res.data,{cluster:'devnet',fundedMint:mint});
});

test('selected reserve lookup reuses an in-progress directory verification',async()=>{
  let reads=0;const wait=deferred();
  const {handle}=createAirdropsRoutes({solanaCluster:'devnet',solanaRpcUrl:'unused',respond,
    store:{read:async()=>{reads++;await wait.promise;return {launches:{[mint]:{mint,onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3'},communityAirdrop:{reservedTokens:10}}}};}},automaticRewardStore:{read:async()=>({})},
    makeReserveConnection:()=>({getGenesisHash:async()=>DEVNET_GENESIS_HASH})});
  const all={},selected={};const first=handle({method:'GET'},all,new URL('https://test/api/airdrops/reserves'));
  await tick();const second=handle({method:'GET'},selected,new URL('https://test/api/airdrops/reserves?mint='+mint));wait.resolve();await Promise.all([first,second]);
  assert.equal(reads,1);assert.equal(selected.status,200);assert.equal(selected.data.checkedAt,all.data.checkedAt);assert.deepEqual(selected.data.reserves,all.data.reserves);
});

test('mint and reserve reads start together and an absent vault is never reported funded',async()=>{
  const wait=deferred(), calls=[];
  const connection={getAccountInfo:async key=>{calls.push(key.toBase58());await wait.promise;const data=Buffer.alloc(82);data[44]=6;return key.toBase58()===mint?{owner:TOKEN_2022_PROGRAM_ID,data}:null;}};
  const pending=readCommunityReserveStatus({connection,programId:mint,authority:mint,mint,reservedTokens:30});
  await tick();assert.equal(calls.length,2);wait.resolve();
  const result=await pending;assert.equal(result.status,'unfunded');assert.equal(result.verified,false);assert.equal(result.vaultInitialized,false);
});
