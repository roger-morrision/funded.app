import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCreatorSupport, updateCreatorProfile, createCreatorSupportHandler } from '../server/creator-support.mjs';
import { normalizeCreatorHandle, creatorSupportPreset, creatorAuthorization, creatorMilestone } from '../creator-support-model.js';
import { createStore } from '../server/store.mjs';
import { isAppPagePath } from '../server/page-routes.mjs';
import { creatorPageHtml } from '../server/creator-social.mjs';

const creatorUiSource = await readFile(new URL('../creator-support-ui.js', import.meta.url), 'utf8');
assert.match(creatorUiSource, /if\(!kind\)\{document\.title='funded\.vip — Launches on the record';return;\}/);

// Local-only fixtures: no keys, chain transactions, or real identities.
const mint='5'.repeat(44), router='2'.repeat(44), recipient='4'.repeat(44), id='123';
const fixture=()=>({ launches:{[mint]:{mint, cluster:'devnet', onchainVerified:true, policySignature:'signed-fixture', xUserId:id, creator:router, creatorWallet:recipient, name:'Fixture coin', symbol:'TEST', pumpFeeRoute:{verified:true,scope:'per-mint-v2',router}, feeDistribution:{creatorDirected:{shares:{solClaimPercent:80},recipients:{xAccount:'@fixture'}}}}},
  collections:{collection:{router}}, obligations:{owed:{id:'owed',xUserId:id,mint,claimSignature:'collection',source:'verified-per-mint-router-collection',amountLamports:'80000000'}},
  claims:{claim:{xUserId:id,obligationId:'owed',publicKey:recipient}}, payouts:{paid:{signature:'payout',claimId:'claim',obligationId:'owed',to:recipient,from:router,mint,cluster:'devnet',source:'mint-router-settle-mint'}},creatorProfiles:{} });
const evidence=()=>({cluster:'devnet',status:'onchain-indexed',verifiedCollections:[{signature:'collection',mint,collectedLamports:100000000}],verifiedPayouts:[{signature:'payout',claimId:'claim',to:recipient,amountLamports:80000000,source:'mint-router-settle-mint',slot:42}]});
assert.equal(normalizeCreatorHandle(' fixture '),'@fixture');
assert.throws(()=>normalizeCreatorHandle('https://x.com/test'));
assert.deepEqual(creatorSupportPreset('fixture'),{creatorWalletPercent:0,holderAirdropPercent:0,solClaimPercent:80,xRecipient:'@fixture'});
assert.equal(creatorAuthorization({identityVerified:true},mint),'fan-created');
assert.equal(creatorMilestone('80000000').achievedLamports,'10000000');
assert.equal(isAppPagePath('/creator/x/123'),true);
assert.equal(isAppPagePath('/creator/x/not-an-id'),false);
const html='<head><title>App</title><meta name="description" content="App" /></head>';
assert.match(creatorPageHtml(html,fixture(),id,'devnet'),/og:title.*Support @fixture/);
assert.equal(buildCreatorSupport(fixture(),id,evidence(),'devnet').paidLamports,'80000000');
assert.equal(buildCreatorSupport(fixture(),id,null,'devnet').paidLamports,'0');
const duplicate=evidence();duplicate.verifiedPayouts.push(duplicate.verifiedPayouts[0]);
assert.equal(buildCreatorSupport(fixture(),id,duplicate,'devnet').paidLamports,'80000000');
for(const tamper of [
  s=>s.claims.claim.xUserId='456', s=>s.claims.claim.obligationId='other', s=>s.claims.claim.publicKey=router,
  s=>s.obligations.owed.amountLamports='80000001', s=>s.obligations.owed.source='unverified', s=>s.obligations.owed.xUserId='456',
  s=>s.collections.collection.router=recipient, s=>s.payouts.paid.from=recipient, s=>s.payouts.paid.to=router,
  s=>s.payouts.paid.cluster='mainnet-beta', s=>s.payouts.paid.mint=router, s=>s.payouts.paid.source='unverified',
]) {const s=fixture();tamper(s);assert.equal(buildCreatorSupport(s,id,evidence(),'devnet').paidLamports,'0');}
for(const tamper of [e=>e.cluster='mainnet-beta', e=>e.verifiedCollections=[], e=>e.verifiedPayouts[0].amountLamports=80000001, e=>e.verifiedPayouts[0].amountLamports=NaN]) {const e=evidence();tamper(e);assert.equal(buildCreatorSupport(fixture(),id,e,'devnet').paidLamports,'0');}
for(const tamper of [s=>s.launches[mint].policySignature=null,s=>s.launches[mint].onchainVerified=false,s=>s.launches[mint].pumpFeeRoute.scope='shared',s=>s.launches[mint].creator=recipient]) {const s=fixture();tamper(s);assert.equal(buildCreatorSupport(s,id,evidence(),'devnet'),null);}
const user={id,username:'fixture',name:'Fixture creator'}, choices={listed:true,optedOut:false,authorizedMints:[mint]};
const state=fixture();updateCreatorProfile(state,user,choices);
assert.equal(buildCreatorSupport(state,id,evidence(),'devnet').coins[0].authorization,'creator-authorized');
assert.throws(()=>updateCreatorProfile(state,user,{...choices,authorizedMints:[router]}));
updateCreatorProfile(state,user,{...choices,optedOut:true});assert.equal(buildCreatorSupport(state,id,evidence(),'devnet'),null);
const excludedHtml=creatorPageHtml(html,state,id,'devnet');assert.match(excludedHtml,/noindex/);assert.doesNotMatch(excludedHtml,/@fixture/);

const dir=await mkdtemp(join(tmpdir(),'funded-creator-test-'));
let server;
try {
  const store=createStore(join(dir,'state.json'),'');
  await store.update(s=>Object.assign(s,fixture()));
  const session={user}; let signedIn=false;
  let evidenceAvailable=true;
  let duringEvidence=null;
  const handler=createCreatorSupportHandler({store,cluster:'devnet',getSession:()=>signedIn?session:null,readEvidence:async()=>{if(duringEvidence)await duringEvidence();return evidenceAvailable?evidence():{status:'unavailable'};},capabilities:async()=>({version:'creator-support-v1',cluster:'devnet',gifts:{enabled:false}})});
  server=createServer(async(req,res)=>{try {if(!await handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}} catch(error){res.writeHead(500);res.end(error.message);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=path=>fetch(base+path);
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify(body)});
  assert.equal((await get('/api/creator-support/me')).status,401);
  assert.equal((await post('/api/creator-support/profile',choices)).status,401);
  assert.equal((await (await get('/api/creators')).json()).creators.length,1);
  assert.equal((await (await get(`/api/creators/${id}`)).json()).paidLamports,'80000000');
  const card=await get(`/api/creators/${id}/card.png`);assert.equal(card.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await card.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal((await get(`/api/creators/${id}/card.png?receipt=payout`)).status,200);
  assert.equal((await get(`/api/creators/${id}/card.png?receipt=unmatched`)).status,404);
  evidenceAvailable=false;
  assert.equal((await get(`/api/creators/${id}/card.png?receipt=payout`)).status,404,'A cached image cannot bypass missing current evidence.');
  evidenceAvailable=true;
  for(const path of [`/api/creators/${id}`,`/api/creators/${id}/card.png?receipt=payout`]) {
    duringEvidence=()=>store.update(s=>{s.creatorProfiles[id]={id,optedOut:true};});
    assert.equal((await get(path)).status,404,'An opt-out while proof is loading must prevent publishing.');
    duringEvidence=null;await store.update(s=>{delete s.creatorProfiles[id];});
  }
  duringEvidence=()=>store.update(s=>{s.obligations.owed.amountLamports='1';});
  assert.equal((await get(`/api/creators/${id}/card.png?receipt=payout`)).status,503,'Changed entitlement cannot reuse an earlier receipt proof.');
  duringEvidence=null;await store.update(s=>{s.obligations.owed.amountLamports='80000000';});
  assert.deepEqual((await(await get('/api/creator-support/following-updates')).json()).creators,[]);
  assert.equal((await get('/api/creator-support/following-updates?ids=invalid')).status,400);
  assert.equal((await(await get(`/api/creator-support/following-updates?ids=${id}`)).json()).creators[0].id,id);
  await store.update(s=>{for(let n=200;n<260;n++)s.creatorProfiles[String(n)]={id:String(n),handle:`@fixture${n}`,listed:true,identityVerified:true};});
  const firstPage=await(await get('/api/creators')).json();assert.equal(firstPage.creators.length,50);assert.ok(firstPage.nextCursor);
  const secondPage=await(await get(`/api/creators?after=${firstPage.nextCursor}`)).json();assert.equal(secondPage.creators.length,11);assert.equal(secondPage.nextCursor,null);assert.equal(new Set([...firstPage.creators,...secondPage.creators].map(c=>c.id)).size,61);
  assert.equal((await(await get('/api/creators?ids=250')).json()).creators[0].id,'250');assert.equal((await get('/api/creators?after=invalid')).status,400);
  await store.update(s=>{for(let n=200;n<260;n++)delete s.creatorProfiles[String(n)];});
  signedIn=true;
  const me=await (await get('/api/creator-support/me')).json();assert.ok(me.csrf);
  assert.equal((await post('/api/creator-support/profile',choices)).status,403);
  const auth={'x-creator-csrf':me.csrf};
  assert.equal((await post('/api/creator-support/profile',choices,{...auth,origin:'https://untrusted.example'})).status,403);
  assert.equal((await post('/api/creator-support/profile',{...choices,authorizedMints:[router]},auth)).status,400);
  assert.equal((await post('/api/creator-support/profile',choices,auth)).status,200);
  assert.equal((await post('/api/creator-support/preferences',{following:['456','456']},auth)).status,200);
  assert.deepEqual((await (await get('/api/creator-support/me')).json()).profile.following,['456']);
  assert.equal((await post('/api/creator-support/updates',{text:'<script>Plain text only</script>'},auth)).status,200);
  assert.equal((await post('/api/creator-support/updates',{text:'x'.repeat(281)},auth)).status,400);
  assert.equal((await post('/api/creator-support/updates',{text:{fake:true}},auth)).status,400);
  const reopened=createStore(join(dir,'state.json'),'');
  assert.equal((await reopened.read()).creatorProfiles[id].updates.length,1);
  const updateId=(await reopened.read()).creatorProfiles[id].updates[0].id;
  assert.equal((await get(`/api/creators/${id}/card.png?update=${updateId}`)).status,200);
  assert.equal((await get(`/api/creators/${id}/card.png?update=${'f'.repeat(24)}`)).status,404);
  assert.equal((await get(`/api/creators/${id}/card.png?update=${updateId}&receipt=payout`)).status,400);
  assert.equal((await post('/api/creator-support/profile',{...choices,optedOut:true},auth)).status,200);
  assert.equal((await get(`/api/creators/${id}`)).status,404);
  assert.equal((await get(`/api/creators/${id}/card.png`)).status,404);
  assert.equal((await get(`/api/creators/${id}/card.png?receipt=payout`)).status,404);
  assert.equal((await get(`/api/creators/${id}/card.png?update=${updateId}`)).status,404);
  assert.equal((await (await get('/api/creators')).json()).creators.length,0);
  assert.equal((await post('/api/creator-support/updates',{text:'blocked'},auth)).status,400);
  for(let i=0;i<10;i++)await post('/api/creator-support/profile',choices,auth);
  assert.equal((await post('/api/creator-support/profile',choices,auth)).status,429);
  console.log('creator support: model, tampering, receipt deduplication, per-coin consent, opt-out, authenticated HTTP, CSRF, rate limiting and file persistence passed (local-only/mocked receipts).');
} finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(dir,{recursive:true,force:true});}
