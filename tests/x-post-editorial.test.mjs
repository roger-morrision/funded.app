import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPayoutDigest,substantiallySimilar,editorialBlock,xEventHash,checkedPayout} from '../server/x-post-editorial.mjs';
import {normalizeXPostEvent} from '../server/x-post-store.mjs';
import {handleAdminXPosts} from '../server/admin-x-posts.mjs';
import bs58 from 'bs58';

const source=(id,amount='1')=>({event:{id,kind:'auto_payout',cluster:'devnet',occurredAt:'2026-10-19T12:00:00Z',text:'Historical verified receipt',
  payout:{kind:'holder',amountLamports:amount,recipient:'11111111111111111111111111111111'},proofs:[{verified:true,cluster:'devnet',commitment:'finalized',slot:123,signature:bs58.encode(Buffer.alloc(64,1))}]}});
test('one daily digest sums exact gross amounts, deduplicates wallets and commits every immutable source',()=>{
  const rows=[source('receipt:b','1000000001'),source('receipt:a','999999999')];
  const digest=buildPayoutDigest(rows,{day:'2026-10-19'});
  assert.match(digest.text,/2 payments to 1 wallets, 2 SOL gross/);assert.match(digest.text,/Devnet test/);
  assert.match(digest.text,/recorded 2026-10-19 UTC/);assert.doesNotMatch(digest.text,/@|Congratulations/);
  assert.equal(digest.proofs.sourceHash,buildPayoutDigest(rows.toReversed(),{day:'2026-10-19'}).proofs.sourceHash);
  assert.notEqual(digest.proofs.sourceHash,buildPayoutDigest([source('receipt:a','1000000000'),source('receipt:b','1000000000')],{day:'2026-10-19'}).proofs.sourceHash);
  assert.equal(normalizeXPostEvent(digest).text,digest.text);
  assert.equal(xEventHash(digest),xEventHash({...digest,proofs:{...digest.proofs}}));
  for(const bad of [[],[source('a'),source('a')],[{event:{...source('a').event,payout:null}}]])assert.throws(()=>buildPayoutDigest(bad,{day:'2026-10-19'}));
  assert.throws(()=>buildPayoutDigest(rows,{day:'2026-02-30'}));
  assert.throws(()=>checkedPayout({...source('a').event.payout,amountLamports:1}));
});
test('similarity holds changed amounts, punctuation, unicode width and token links, but allows distinct useful content',()=>{
  const old='[Devnet test] AI marketing team spotlight: Alpha. Explore this launched coin and its public activity on funded.vip. https://funded.vip/token/AAA';
  assert(substantiallySimilar(old,old.replace('Alpha','Beta').replace('/AAA','/BBB')));
  assert(substantiallySimilar('Reward paid: 1.25 SOL on 2026-10-19','Ｒｅｗａｒｄ paid! 8.5 SOL on 2026-10-20'));
  assert(!substantiallySimilar(old,'Maintenance complete: transaction receipt search now supports full wallet history and finalized slot filters.'));
  assert.equal(editorialBlock(source('a').event),'legacy-payout-posts-disabled');
  assert.equal(editorialBlock({kind:'agency_promotion',text:'Visit @unsolicited today'}),'unsolicited-mentions-disabled');
});
test('signed admin review records the session actor and cannot publish or resume the suspended account',async()=>{
  const calls=[];let output,input={id:'a',expectedHash:'a'.repeat(64),decision:'approved',reason:'Reviewed factual summary.',actor:'forged'};
  const fake={init:async()=>calls.push('init'),close:async()=>calls.push('close'),safetyStatus:async()=>({paused:true}),list:async()=>[],
    review:async value=>{calls.push(value);return{event:{id:'a'}};},pause:async()=>({paused:true})};
  const run=async(method,path)=>{output=null;await handleAdminXPosts({req:{method},res:{},url:new URL(path,'https://funded.vip'),body:async()=>input,
    respond:(r,status,value)=>output={status,value},session:{wallet:'trusted'},env:{DATABASE_URL:'synthetic'},createStore:()=>fake});return output;};
  assert.equal((await run('GET','/api/admin/x-posts')).value.safety.paused,true);
  const result=await run('POST','/api/admin/x-posts/review');assert.equal(result.value.published,false);assert.equal(calls.find(row=>row?.decision).actor,'trusted');
  assert.equal((await run('POST','/api/admin/x-posts/resume')).status,404);
  assert.equal((await run('POST','/api/admin/x-posts/pause')).value.safety.paused,true);
  assert.equal(calls.filter(row=>row==='close').length,4);
});
