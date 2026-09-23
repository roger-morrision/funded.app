import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createStore} from '../server/store.mjs';
import {scopedReferralClaimState} from '../server/referral-claim-state.mjs';

export async function verifyReferralScopedStore(store,other=store,concurrent=false){
  const a='scoped-referral-a',b='scoped-referral-b';
  await store.update(s=>{for(const id of [a,b])s.referralClaims[id]={id,recipientWallet:'synthetic-wallet',publicKey:'synthetic-wallet',amount:0.01,asset:'SOL',settlementSignature:'synthetic-source',level:1,nonce:'original',status:'wallet-verified',counter:0};});
  assert.deepEqual(await other.readReferralClaimState(a),scopedReferralClaimState(await store.read(),a));
  await Promise.all([...Array.from({length:20},(_,n)=>(n%2?store:other).updateReferralClaimState(a,s=>{s.referralClaims[a].counter++;})),store.update(s=>{s.referralClaims[a].counter++;})]);
  assert.equal((await other.readReferralClaimState(a)).referralClaims[a].counter,21);
  for(const mutate of [s=>{s.referralClaims[a].amount=9;},s=>{s.referralClaims[a].recipientWallet='other';},s=>{s.referralClaims[a].publicKey='other';},s=>{s.referralClaims[a].nonce='new';},s=>{s.referralClaims[a].status='paid';},s=>{delete s.referralClaims[a];},s=>{s.referralClaims[b]={id:b};},s=>{s.collections={};},s=>{s.payouts.other={claimId:a};}]){
    await assert.rejects(store.updateReferralClaimState(a,s=>{s.referralClaims[a].counter=999;mutate(s);}));
    assert.equal((await other.readReferralClaimState(a)).referralClaims[a].counter,21);
  }
  for(const id of ['__proto__','constructor','../claim',''])await assert.rejects(store.readReferralClaimState(id));
  await assert.rejects(store.updateReferralClaimState('missing',s=>{s.referralClaims.missing={id:'missing'};}));
  if(concurrent){let entered,release,timer;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
    const first=store.updateReferralClaimState(a,async s=>{entered();await gate;s.referralClaims[a].counter++;});
    try{await started;await Promise.race([other.updateReferralClaimState(b,s=>{s.referralClaims[b].counter++;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Unrelated referral claim blocked.')),5000);})]);}
    finally{clearTimeout(timer);release();await first;}
  }
  const attempts=await Promise.all([store,other].map(db=>db.updateReferralClaimState(a,s=>{if(s.referralClaims[a].status!=='wallet-verified')return false;s.referralClaims[a].status='executing';return true;})));
  assert.equal(attempts.filter(Boolean).length,1,'Only one contender can lock execution.');
  const paid=(s,overrides={})=>{const payoutId=`referral:${a}`,paidAt=new Date().toISOString();s.referralClaims[a]={...s.referralClaims[a],status:'paid',payoutId,payoutSignature:'synthetic-signature',paidAt};s.payouts[payoutId]={id:payoutId,claimId:a,to:'synthetic-wallet',signature:'synthetic-signature',amountSol:0.01,status:'paid',cluster:'devnet',paidAt,...overrides};};
  for(const overrides of [{to:'other'},{claimId:b},{amountSol:999},{signature:'wrong'},{status:'submitted'},{paidAt:'wrong'}])await assert.rejects(store.updateReferralClaimState(a,s=>paid(s,overrides)));
  assert.equal((await other.readReferralClaimState(a)).referralClaims[a].status,'executing');
  await store.updateReferralClaimState(a,paid);
  await assert.rejects(store.updateReferralClaimState(a,s=>{s.referralClaims[a].status='wallet-verified';}));
  await assert.rejects(store.updateReferralClaimState(a,s=>{delete s.payouts[`referral:${a}`];}));
  assert.equal((await other.readReferralClaimState(a)).payouts[`referral:${a}`].amountSol,0.01);
  // Historical random payout IDs remain readable; no migration rewrites receipts.
  await store.update(s=>{s.referralClaims.legacy={id:'legacy',status:'paid',payoutId:'legacy-random'};s.payouts['legacy-random']={id:'legacy-random',claimId:'legacy',signature:'historical'};});
  assert.equal((await other.readReferralClaimState('legacy')).payouts['legacy-random'].signature,'historical');
  await store.update(s=>{s.referralClaims.collision={...s.referralClaims[b],id:'collision',status:'executing'};s.payouts['referral:collision']={id:'referral:collision',claimId:'unrelated',signature:'preserve'};});
  await assert.rejects(store.updateReferralClaimState('collision',s=>{s.payouts['referral:collision'].signature='overwritten';}));
  assert.equal((await other.readReferralClaimState('collision')).payouts['referral:collision'].signature,'preserve');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const dir=await mkdtemp(join(tmpdir(),'funded-referral-scope-'));try{await verifyReferralScopedStore(createStore(join(dir,'state.json'),''));console.log('Scoped referral store: isolation, legacy-writer coexistence, rollback, single execution lock, immutable entitlement and atomic exact payout passed (synthetic only).');}finally{await rm(dir,{recursive:true,force:true});}}
