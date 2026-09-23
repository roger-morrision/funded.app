import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createStore } from '../server/store.mjs';
import { scopedClaimState,assertObservedClaim } from '../server/claim-state.mjs';

export async function verifyClaimState(store,other=store,concurrent=false) {
  await store.update(s=>{for(const id of ['scope-a','scope-b']){s.claims[id]={id,xUserId:'123',obligationId:id,recipient:'@fixture',nonce:'nonce',publicKey:'4'.repeat(44),status:'wallet-verified',counter:0};s.obligations[id]={id,mint:'5'.repeat(44),claimSignature:'scope-collection',amountLamports:'100'};}});
  assert.deepEqual(await other.readClaimState('scope-a'),scopedClaimState(await store.read(),'scope-a'));
  await Promise.all([...Array.from({length:20},(_,i)=>(i%2?store:other).updateClaimState('scope-a',s=>{s.claims['scope-a'].counter++;})),store.update(s=>{s.claims['scope-a'].counter++;})]);
  assert.equal((await other.readClaimState('scope-a')).claims['scope-a'].counter,21);
  for(const mutate of [s=>{s.claims['scope-b']={id:'scope-b'};},s=>{s.obligations['scope-a'].amountLamports='999';},s=>{s.claims['scope-a'].publicKey='different';},s=>{s.claims['scope-a'].xUserId='456';},s=>{s.claims['scope-a'].status='paid';},s=>{s.payouts['x:scope-a']={id:'x:scope-a',claimId:'scope-b'};}]) {
    await assert.rejects(store.updateClaimState('scope-a',s=>{s.claims['scope-a'].counter=999;mutate(s);}));
    assert.equal((await other.readClaimState('scope-a')).claims['scope-a'].counter,21,'Invalid transitions roll back.');
  }
  for(const id of ['__proto__','constructor','../wallet',''])await assert.rejects(store.readClaimState(id));
  const observed=(await store.readClaimState('scope-a')).claims['scope-a'];
  assert.throws(()=>assertObservedClaim({...observed,nonce:'renewed'},observed));
  assert.throws(()=>assertObservedClaim({...observed,expiresAt:'2000-01-01'},observed));
  if(concurrent){let entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let timer;
    const first=store.updateClaimState('scope-a',async s=>{entered();await gate;s.claims['scope-a'].counter++;});
    try{await started;await Promise.race([other.updateClaimState('scope-b',s=>{s.claims['scope-b'].counter++;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Unrelated claim blocked.')),5000);})]);}
    finally{clearTimeout(timer);release();await first;}}
  await store.updateClaimState('scope-a',s=>{s.claims['scope-a'].status='paid';s.payouts['x:scope-a']={id:'x:scope-a',claimId:'scope-a',amountLamports:'100'};});
  await assert.rejects(store.updateClaimState('scope-a',s=>{s.claims['scope-a'].status='wallet-verified';}));
  await assert.rejects(store.updateClaimState('scope-a',s=>{s.payouts['x:scope-a'].amountLamports='101';}));
  assert.equal((await other.readClaimState('scope-a')).payouts['x:scope-a'].amountLamports,'100');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const dir=await mkdtemp(join(tmpdir(),'funded-claim-state-'));try{await verifyClaimState(createStore(join(dir,'state.json'),''));console.log('Scoped claims: legacy coexistence, concurrency, wallet/identity/nonce guards, rollback and atomic immutable payout records passed (local-only, no transfers).');}finally{await rm(dir,{recursive:true,force:true});}}
