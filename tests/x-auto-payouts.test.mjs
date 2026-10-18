import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {automaticPayoutCandidates,createAutomaticPayoutVerifier} from '../server/x-auto-payouts.mjs';
import {collectXPostEvents} from '../server/x-post-events.mjs';
import {buildXPost,xWeightedLength} from '../server/x-post-content.mjs';
import {xWorkerConfig} from '../scripts/run-x-post-worker.mjs';

const [mint,recipient,program]=[1,2,3].map(n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey.toBase58());
const signature=bs58.encode(Buffer.alloc(64,1)),paidAt='2026-10-18T14:40:00Z';
const launch={mint,cluster:'devnet',onchainVerified:true,pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId:program}};
const payment={signature,amount:'1000',finalized:true,balanceDeltaVerified:true,status:'paid',paidAt};
const state={launches:{[mint]:launch},v3CreatorWalletPayout:{source:{mint,signature,recipient,status:'finalized',balanceDeltaVerified:true,finalizedAt:paidAt,collectionSignature:'source'}}};
const proof={signature,slot:123,verified:true,commitment:'finalized',cluster:'devnet'};
const verified=row=>({mint,recipient:row.recipient,receiptId:row.receiptId,payoutKind:row.kind,amountLamports:'1000',netLamports:'1000',feeLamports:'5000',rentLamports:'0',occurredAt:paidAt,proofs:[proof]});
const options={state,enabledAt:'2026-10-18T14:30:00Z',now:'2026-10-18T14:50:00Z',payoutsOnly:true};

test('only actual paid recipient ledgers qualify; vault funding, failed rows, retired routes and buybacks are excluded',()=>{
  const source={...structuredClone(state),v3CommunityFunding:{x:{...payment,mint,recipient,status:'finalized'}},v3CreatorRewardFunding:{x:{...payment,mint,recipient,status:'finalized'}},v3BuybackOrders:{x:{...payment,mint,status:'finalized'}}};
  const rewards={schedules:{one:{mint,kind:'holder',asset:'SOL',payments:{[recipient]:payment}},bad:{mint,kind:'holder',asset:'SOL',payments:{[recipient]:{...payment,status:'verification-pending'}}}}};
  assert.deepEqual(automaticPayoutCandidates(source,rewards).map(row=>row.kind),['holder','creator']);
  source.launches[mint].pumpFeeRoute.scope='per-mint-v2';assert.deepEqual(automaticPayoutCandidates(source,rewards),[]);
});

test('all payout templates mask wallets, omit full signatures and preserve exact finalized amounts',()=>{
  for(const payoutKind of ['holder','creator','referral','x','operations','bonus']) {
    const draft=buildXPost('auto_payout',{recipient,payoutKind,amountLamports:'1000',netLamports:'1000',feeLamports:'5000',rentLamports:'0',proofs:[proof]},{cluster:'devnet'});
    assert.match(draft.text,/\[Devnet test\] Congratulations/);assert(draft.text.includes(recipient.slice(0,4)+'...'+recipient.slice(-4)));
    assert(!draft.text.includes(recipient));assert(!draft.text.includes(signature));assert.match(draft.text,/0\.000001 SOL/);assert(xWeightedLength(draft.text)<=280);assert(Buffer.byteLength(draft.text)<=280);
  }
  const payload={recipient,payoutKind:'holder',amountLamports:'215886',netLamports:'-947354',feeLamports:'5000',rentLamports:'1158240',proofs:[proof]};
  const draft=buildXPost('auto_payout',payload,{cluster:'devnet'});assert.match(draft.text,/0\.000215886 SOL gross/);assert.match(draft.text,/Net wallet change: -0\.000947354 SOL/);
  assert.throws(()=>buildXPost('auto_payout',{...payload,netLamports:'100'},{cluster:'devnet'}),/reconcile/);
  assert.throws(()=>buildXPost('auto_payout',{...payload,proofs:[{...proof,verified:false}]},{cluster:'devnet'}),/finalized/);
});

test('payout collection is isolated, stable across replay and late writes, and deduplicates aliases',async()=>{
  const first=await collectXPostEvents({...options,adapters:{verifyAutomaticPayout:async row=>verified(row)}});
  assert.equal(first.events.length,1);assert.equal(first.events[0].kind,'auto_payout');assert.deepEqual(first.sourceGaps,[]);
  const replay=await collectXPostEvents({...options,cursor:first.cursor,adapters:{verifyAutomaticPayout:async()=>{throw new Error('Known payment must not be reverified');},isKnownEvent:async id=>id===first.events[0].id}});
  assert.equal(replay.events.length,0);
  const alias=structuredClone(state);alias.v3CreatorWalletPayout.alias=alias.v3CreatorWalletPayout.source;
  const duplicate=await collectXPostEvents({...options,state:alias,adapters:{verifyAutomaticPayout:async row=>verified(row)}});assert.equal(duplicate.events.length,1);assert.equal(duplicate.events[0].id,first.events[0].id);
  const old=await collectXPostEvents({...options,enabledAt:'2026-10-18T14:41:00Z',adapters:{verifyAutomaticPayout:async row=>verified(row)}});assert.equal(old.events.length,0);
});

test('missing or forged finalized evidence remains pending and can recover without losing its event',async()=>{
  const failed=await collectXPostEvents({...options,adapters:{verifyAutomaticPayout:async row=>({...verified(row),recipient:program})}});
  assert.equal(failed.events.length,0);assert.equal(failed.cursor.streams.auto_payout.pending.length,1);
  const recovered=await collectXPostEvents({...options,cursor:failed.cursor,adapters:{verifyAutomaticPayout:async row=>verified(row)}});assert.equal(recovered.events.length,1);assert.equal(recovered.cursor.streams.auto_payout.pending.length,0);
});

test('recovering a payment signature preserves its stable receipt event ID',async()=>{
  const paymentPda=Keypair.fromSeed(Buffer.alloc(32,9)).publicKey.toBase58();
  const rewardState={schedules:{one:{mint,kind:'holder',asset:'SOL',payments:{[recipient]:{...payment,payment:paymentPda}}}}};
  const input={...options,state:{launches:state.launches},rewardState,adapters:{verifyAutomaticPayout:async row=>verified(row)}};
  const first=await collectXPostEvents(input);assert.equal(first.events.length,1);
  rewardState.schedules.one.payments[recipient].signature=null;
  const recovered=await collectXPostEvents(input);assert.equal(recovered.events.length,1);assert.equal(first.events[0].id,recovered.events[0].id);
  assert.deepEqual(first.events[0].payload,recovered.events[0].payload);
});

test('payout verifier rejects an unapproved program before reading any payment',async()=>{
  const verifier=createAutomaticPayoutVerifier({connection:{getGenesisHash:async()=>'wrong-chain'},programId:program,authority:recipient,approvedHash:'a'.repeat(64)});
  await assert.rejects(()=>verifier.verifyAutomaticPayout({mint},{state,rewardState:{}}));
  const badHash=createAutomaticPayoutVerifier({connection:{getGenesisHash:async()=>'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'},programId:program,authority:recipient,approvedHash:'a'.repeat(64),readProgram:async()=>({account:{executable:true},sha256:'b'.repeat(64)})});
  await assert.rejects(()=>badHash.verifyPayoutReadiness());
});

test('payout-only worker mode must be explicit and rejects misspelled configuration',()=>{
  const env={DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1/test',X_POST_EXPECTED_HANDLE:'fundedvip',X_POST_PUBLIC_ORIGIN:'https://funded.vip',X_POST_START_AT:'2026-10-18T00:00:00Z'};
  assert.equal(xWorkerConfig(env).payoutsOnly,false);assert.equal(xWorkerConfig({...env,X_POST_PAYOUTS_ONLY:'true'}).payoutsOnly,true);
  assert.throws(()=>xWorkerConfig({...env,X_POST_PAYOUTS_ONLY:'yes'}),/true or false/);
});
