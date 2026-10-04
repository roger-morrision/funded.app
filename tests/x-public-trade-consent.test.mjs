import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createStore } from '../server/store.mjs';
import { createPublicTradeConsent, publicTradeShareConfig } from '../server/x-public-trade-consent.mjs';
const signer = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(71));
const input = { wallet:bs58.encode(signer.publicKey), mint:bs58.encode(new Uint8Array(32).fill(72)), buySignature:bs58.encode(new Uint8Array(64).fill(73)), sellSignature:bs58.encode(new Uint8Array(64).fill(74)) };
const config = publicTradeShareConfig({ X_PUBLIC_TRADE_SHARES_ENABLED:'true', X_POST_PUBLIC_ORIGIN:'https://funded.vip', X_POST_EXPECTED_HANDLE:'johntrand83' });
const proof = () => ({ wallet:input.wallet,mint:input.mint,publicConsent:true,completeCostBasis:true,positionClosed:true,buyCostLamports:'1000000000',sellProceedsLamports:'2200000000',feesLamports:'10000' });
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(),'public-share-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const path = join(dir,'state.json'), store = createStore(path,'');
  const service = createPublicTradeConsent({store,config,verifyTrade:async()=>proof(),...options});
  const challenge = await service.prepare(input,config.origin);
  const approval = {challengeId:challenge.challengeId,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.statement),signer.secretKey))};
  return {service,store,path,challenge,approval};
}
test('public sharing requires explicit Devnet configuration and canonical public origin',()=>{
  assert.equal(config.enabled,true);
  for (const env of [{}, {X_POST_PUBLIC_ORIGIN:'http://funded.vip'}, {X_POST_PUBLIC_ORIGIN:'https://127.0.0.1'}, {X_POST_EXPECTED_HANDLE:''}]) assert.equal(publicTradeShareConfig({X_PUBLIC_TRADE_SHARES_ENABLED:'true',X_POST_PUBLIC_ORIGIN:config.origin,X_POST_EXPECTED_HANDLE:config.account,...env,X_PUBLIC_TRADE_SHARES_ENABLED: Object.keys(env).length ? 'true':'false'}).enabled,false);
  assert.equal(publicTradeShareConfig({X_PUBLIC_TRADE_SHARES_ENABLED:'true',X_POST_PUBLIC_ORIGIN:config.origin,X_POST_EXPECTED_HANDLE:config.account},'mainnet-beta').enabled,false);
});
test('signed consent is durable, one-pair scoped and idempotent across retries and restart',async t=>{
  const f=await fixture(t);
  assert.match(f.challenge.statement,/Purpose: publish-closed-trade-on-x/);
  assert.match(f.challenge.statement,/X account: @johntrand83/);
  const results=await Promise.all([f.service.accept(f.approval,config.origin),f.service.accept(f.approval,config.origin)]);
  assert.equal(results.filter(r=>r.created).length,1);
  assert.equal(Object.keys((await f.store.read()).xPublicTradeShares).length,1);
  const next=createPublicTradeConsent({store:createStore(f.path,''),config,verifyTrade:()=>assert.fail('No repeat RPC verification'),now:()=>Date.now()+600000});
  const replay=await next.accept(f.approval,config.origin);
  assert.equal(replay.created,false); assert.equal(replay.share.id,results[0].share.id);
  assert.equal(JSON.stringify(replay).includes(f.approval.signature),false);
});
test('wrong origin, tampered approval and expired challenge cannot create a public row',async t=>{
  let now=Date.now(); const f=await fixture(t,{now:()=>now});
  await assert.rejects(f.service.accept(f.approval,'https://attacker.org'),{statusCode:403});
  await assert.rejects(f.service.accept({...f.approval,signature:input.buySignature},config.origin),{statusCode:403});
  now+=300001;
  await assert.rejects(f.service.accept(f.approval,config.origin),{statusCode:409});
  assert.deepEqual((await f.store.read()).xPublicTradeShares,{});
});
test('failed verification and insufficient attributable profit do not consume approval',async t=>{
  let mode='error';const f=await fixture(t,{verifyTrade:async()=>{if(mode==='error')throw Error('private RPC credentials');return {...proof(),sellProceedsLamports:mode==='low'?'1000000001':'2200000000'};}});
  await assert.rejects(f.service.accept(f.approval,config.origin),e=>e.statusCode===422&&!e.message.includes('credentials'));
  mode='low';await assert.rejects(f.service.accept(f.approval,config.origin),{statusCode:422});
  assert.deepEqual((await f.store.read()).xPublicTradeShares,{});
  mode='success';assert.equal((await f.service.accept(f.approval,config.origin)).created,true);
});
test('approval that expires during receipt verification is not durably accepted',async t=>{
  let now=Date.now(); const f=await fixture(t,{now:()=>now,verifyTrade:async()=>{now+=300001;return proof();}});
  await assert.rejects(f.service.accept(f.approval,config.origin),{statusCode:409});
  assert.deepEqual((await f.store.read()).xPublicTradeShares,{});
});
