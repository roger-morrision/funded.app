import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { xWorkerConfig, runXPostCycle } from '../scripts/run-x-post-worker.mjs';
import { createXPostChainAdapters } from '../server/x-post-events.mjs';
import { createXPublisher } from '../server/x-post-client.mjs';
import { buildXPost } from '../server/x-post-content.mjs';

const environment = {
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:15433/funded_x_test',
  X_POST_EXPECTED_HANDLE: '@FundedFixture', X_POST_PUBLIC_ORIGIN: 'https://funded.vip', X_POST_START_AT: '2026-10-01T00:00:00Z',
};
test('CLI defaults to draft and normalizes the explicit target account', () => {
  const config = xWorkerConfig(environment);
  assert.equal(config.execute, false); assert.equal(config.mode, 'once');
  assert.equal(config.handle, 'fundedfixture'); assert.equal(config.cluster, 'devnet');
  assert.equal(config.maxHourlyPosts, 6); assert.equal(config.maxDailyPosts, 24);
  assert.equal(xWorkerConfig(environment, ['--status']).mode, 'status');
});
test('CLI requires independent explicit live gates and a dedicated publication token', () => {
  assert.throws(() => xWorkerConfig(environment, ['--execute']), /X_POST_ENABLED/);
  assert.throws(() => xWorkerConfig({ ...environment, X_POST_ENABLED: 'true' }, ['--execute']), /ALLOW_DEVNET/);
  assert.throws(() => xWorkerConfig({ ...environment, X_POST_ENABLED: 'true', X_POST_ALLOW_DEVNET: 'true' }, ['--execute']), /ACCESS_TOKEN/);
  const enabled = { ...environment, X_POST_ENABLED: 'true', X_POST_ALLOW_DEVNET: 'true', X_POST_ACCESS_TOKEN: 'synthetic-fixture' };
  assert.equal(xWorkerConfig(enabled, ['--execute']).execute, true);
  assert.equal(xWorkerConfig(enabled).execute, false, 'Environment alone must not enable publishing');
});
test('CLI rejects ambiguous modes, wrong networks and unsafe public destinations', () => {
  for (const args of [['--once','--loop'], ['--status','--once'], ['--unknown']]) assert.throws(() => xWorkerConfig(environment, args));
  for (const SOLANA_CLUSTER of ['mainnet-beta', 'testnet', 'mainnet']) assert.throws(() => xWorkerConfig({ ...environment, SOLANA_CLUSTER }), /Devnet/);
  for (const X_POST_PUBLIC_ORIGIN of ['http://funded.vip', 'https://localhost', 'https://127.0.0.1', 'https://funded.vip/other', 'https://secret@funded.vip', 'https://internal.test']) assert.throws(() => xWorkerConfig({ ...environment, X_POST_PUBLIC_ORIGIN }));
  for (const changes of [{X_POST_START_AT:'invalid'}, {X_POST_START_AT:'2999-01-01'}, {X_POST_MAX_HOURLY:'0'}, {X_POST_MAX_DAILY:'1441'}, {X_POST_MIN_PROFIT_LAMPORTS:'1.5'}, {DATABASE_URL:'https://funded.vip'}]) assert.throws(() => xWorkerConfig({ ...environment, ...changes }));
});
test('a queued wrong-network event fails closed before any publication request', async () => {
  let claimed = false, failed = false, sends = 0;
  const store = {
    leaseMs: 60_000, readCursor: async () => ({version:0,cursor:null}), has: async () => false, enqueueBatch: async () => {},
    claim: async () => { if(claimed) return null; claimed=true; return {event:{id:'wrong-network',cluster:'mainnet-beta',text:'Wrong network'},token:'fixture'}; },
    fail: async (id,token,reason) => { assert.equal(id,'wrong-network'); assert.equal(token,'fixture'); assert.equal(reason,'delivery-rejected'); failed=true; },
  };
  const config = {...xWorkerConfig(environment), execute:true};
  const report = await runXPostCycle({ config, store, mainStore:{read:async()=>({})}, readRewards:async()=>null, adapters:{}, publish:async()=>{sends++;}, now:Date.parse('2026-10-04T12:00:00Z') });
  assert.equal(failed,true); assert.equal(sends,0); assert.equal(report.dispatch.failed,1);
});

function dailyPipelineFixture() {
  const mint=bs58.encode(new Uint8Array(32).fill(1)), recipient=bs58.encode(new Uint8Array(32).fill(2)), router=bs58.encode(new Uint8Array(32).fill(3));
  const signature=bs58.encode(new Uint8Array(64).fill(9)), collectionSignature=bs58.encode(new Uint8Array(64).fill(10));
  const state={launches:{[mint]:{mint,name:'Fixture'}},payouts:{claim:{id:'referral:claim',claimId:'claim',signature,source:'solana-keeper-referral-claim',status:'paid',cluster:'devnet',from:router,to:recipient,amountLamports:'15'}},
    collections:{[collectionSignature]:{signature:collectionSignature,mint,router,status:'collected',attribution:'mint-verified',onchainVerified:true,cluster:'devnet',collectedLamports:1000000000}},
    referralClaims:{claim:{id:'claim',status:'paid',asset:'SOL',recipientWallet:recipient,publicKey:recipient,payoutSignature:signature,amount:1.5e-8,settlementSignature:collectionSignature,level:1}},
    settlements:{[collectionSignature]:{fundedApp:{referralLevels:[{level:1,recipient,amount:1.5e-8}]}}}};
  const transaction=(sig,keys,preBalances,postBalances)=>({slot:123,blockTime:Date.parse('2026-10-03T12:00:00Z')/1000,transaction:{signatures:[sig],message:{accountKeys:keys}},meta:{err:null,preBalances,postBalances}});
  const transactions={[signature]:transaction(signature,[router,recipient],[20000,0],[14985,15]),[collectionSignature]:transaction(collectionSignature,[router],[0],[1000000000])};
  const rpcCalls=[];
  const adapters=createXPostChainAdapters({connection:{getGenesisHash:async()=>{rpcCalls.push('genesis');return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';},getTransaction:async(sig,options)=>{assert.equal(options.commitment,'finalized');rpcCalls.push(sig);return transactions[sig];}}});
  // An in-memory outbox isolates this pipeline test; durable concurrency has a
  // separate PostgreSQL integration harness.
  let checkpoint={version:0,cursor:null};const rows=new Map();
  const store={leaseMs:60000,readCursor:async()=>structuredClone(checkpoint),has:async id=>rows.has(id),list:async()=>[...rows.values()],
    enqueueBatch:async(events,{cursor,version})=>{assert.equal(version,checkpoint.version);for(const event of events){assert(!rows.has(event.id));rows.set(event.id,{event,status:'pending'});}checkpoint={version:version+1,cursor:structuredClone(cursor)};},
    claim:async()=>{const row=[...rows.values()].find(row=>row.status==='pending');if(!row)return null;row.status='sending';return {event:row.event,token:row.event.id};},
    markPosted:async(id,token,result)=>{assert.equal(id,token);Object.assign(rows.get(id),{status:'posted',result});},
    markUncertain:async()=>assert.fail('Unexpected uncertain mock delivery'),retryLater:async()=>assert.fail('Unexpected mock retry'),fail:async()=>assert.fail('Unexpected mock rejection')};
  const transport=[];
  const publisher=createXPublisher({accessToken:'local-test-token',expectedHandle:'FundedFixture',fetchImpl:async(url,options)=>{
    transport.push({url,method:options.method,body:options.body?JSON.parse(options.body):null});
    if(url==='https://api.x.com/2/users/me'){assert.equal(options.method,'GET');return new Response(JSON.stringify({data:{id:'123',username:'FundedFixture'}}));}
    assert.equal(url,'https://api.x.com/2/tweets');assert.equal(options.method,'POST');return new Response(JSON.stringify({data:{id:String(1000+transport.length)}}));
  }});
  const config={...xWorkerConfig(environment),execute:true,maxPosts:2};
  return {state,adapters,store,rows,rpcCalls,transport,publisher,options:{config,store,mainStore:{read:async()=>state},readRewards:async()=>({schedules:{}}),publish:(event,options)=>publisher.publish(event,options),now:Date.parse('2026-10-04T12:00:00Z')}};
}

test('malformed daily windows make no RPC or publication calls and retain both cursors for valid retry',async()=>{
  for(const malformed of [{windowStart:null},{windowStart:'invalid'},{windowStart:'2026-02-30T00:00:00Z'},{windowStart:'2026-10-03T00:00:00+00:00'},{windowEnd:'2026-10-03T23:59:00.000Z'},{windowEnd:'2026-10-05T00:00:00.000Z'}]){
    const fixture=dailyPipelineFixture();
    const invalid={...fixture.adapters,verifiedDailyProjects:input=>fixture.adapters.verifiedDailyProjects({...input,...malformed}),verifiedDailyRewards:input=>fixture.adapters.verifiedDailyRewards({...input,...malformed})};
    const blocked=await runXPostCycle({...fixture.options,adapters:invalid});
    assert.equal(blocked.collected,0);assert.equal(blocked.dispatch.claimed,0);assert.equal(fixture.rows.size,0);assert.deepEqual(fixture.rpcCalls,[]);assert.deepEqual(fixture.transport,[]);
    const cursor=(await fixture.store.readCursor()).cursor;
    for(const kind of ['daily_projects','daily_rewards']){assert.equal(cursor.streams[kind],undefined);assert(blocked.sourceGaps.some(gap=>gap.source===kind&&/no summary/.test(gap.reason)));}
    await fixture.publisher.verifyAccount();
    const recovered=await runXPostCycle({...fixture.options,adapters:fixture.adapters});
    assert.equal(recovered.collected,2);assert.equal(recovered.dispatch.posted,2);assert.equal(fixture.rows.size,2);assert(fixture.rpcCalls.length>0);
    const posts=fixture.transport.filter(call=>call.method==='POST');assert.equal(posts.length,2);
    for(const post of posts){assert.match(post.body.text,/^\[Devnet test\]/);assert.match(post.body.text,/0\.000000015\b/);assert.match(post.body.text,/\bSOL\b/);assert.match(post.body.text,/2026-10-03 00:00 to 2026-10-04 00:00 UTC/);}
    for(const kind of ['daily_projects','daily_rewards'])assert.equal((await fixture.store.readCursor()).cursor.streams[kind].windowEnd,'2026-10-04T00:00:00.000Z');
    const rpcCount=fixture.rpcCalls.length,transportCount=fixture.transport.length;
    const replay=await runXPostCycle({...fixture.options,adapters:fixture.adapters});
    assert.equal(replay.collected,0);assert.equal(replay.dispatch.posted,0);assert.equal(fixture.rpcCalls.length,rpcCount);assert.equal(fixture.transport.length,transportCount);
  }
});

test('formatter independently rejects malformed daily metadata even on otherwise verified adapter output',async()=>{
  const fixture=dailyPipelineFixture();
  const input={state:fixture.state,rewardState:{schedules:{}},windowStart:'2026-10-03T00:00:00.000Z',windowEnd:'2026-10-04T00:00:00.000Z'};
  for(const [kind,provider] of [['daily_projects',fixture.adapters.verifiedDailyProjects],['daily_rewards',fixture.adapters.verifiedDailyRewards]]){
    const verified=await provider(input);
    const formatted=buildXPost(kind,verified,{cluster:'devnet'}).text;assert.match(formatted,/0\.000000015\b/);assert.match(formatted,/\bSOL\b/);
    for(const changes of [{windowStart:null},{windowEnd:'invalid'},{windowStart:'2026-10-03T00:00:00+00:00'},{windowEnd:'2026-10-05T00:00:00Z'}])assert.throws(()=>buildXPost(kind,{...verified,...changes},{cluster:'devnet'}),/UTC|window/i);
  }
  assert.deepEqual(fixture.transport,[]);
});
