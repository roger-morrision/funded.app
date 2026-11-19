// Run inside the accepted funded.vip Devnet app container. No private keys or
// cookies are written: disposable wallets live only for this process lifetime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync,
  createBurnInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import { createRemoteSigner } from '../server/remote-signer.mjs';
import { sendAndConfirmSigned } from '../server/transaction-signing.mjs';
import { createAutomaticRewardChain, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import { buildRewardManifest } from '../reward-merkle.js';

const emit = data => console.log(JSON.stringify({ at:new Date().toISOString(), ...data }));
const secret = name => process.env[name] || (process.env[name+'_FILE'] ? fs.readFileSync(process.env[name+'_FILE'],'utf8').trim() : '');
assert.equal(process.env.SOLANA_CLUSTER,'devnet');
assert.equal(process.env.REWARD_BATCH_LIVE_VERIFY,'devnet-ephemeral');
const rpcFetch = async (url, options) => {
  for(let attempt=0;;attempt++) {
    try { const r=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
      const body=await r.clone().json().catch(()=>null);
      const limited=[429,502,503,504].includes(r.status)||body?.error?.code===429
        || /rate limit|too many requests/i.test(String(body?.error?.message||''));
      if(!limited||attempt>=12)return r; await r.text();
    } catch(error) { if(attempt>=12)throw error; }
    emit({type:'rpc-retry',attempt:attempt+1}); await new Promise(resolve=>setTimeout(resolve,30000));
  }
};
const connection = new Connection(secret('SOLANA_RPC_URL'),{commitment:'finalized',disableRetryOnRateLimit:true,fetch:rpcFetch});
assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
// Use the same finalized transaction provider for this isolated verification.
// The optional evidence provider has its own connection/limits; the full
// executable hash and network checks still run through the primary connection.
process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL='';
const remote=createRemoteSigner(),authority=remote.handle('authority'),keeper=remote.handle('keeper');
assert(authority&&keeper);assert(await connection.getBalance(authority.publicKey)>200000000);
const chain=createAutomaticRewardChain({connection,programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority,
  expectedProgramDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256,cluster:'devnet'});
assert.equal((await chain.readiness()).constrainedPayouts,true);
const recipients=Array.from({length:4},()=>Keypair.generate()),qa=Keypair.generate();
let tokenMint;
const state={schedules:{},programs:{}},store={transaction:async fn=>fn(state),read:async()=>structuredClone(state)};
const scheduler=createRewardScheduler({store,chain,indexer:{},cluster:'devnet'});
const summaries=[];
async function run(mint,asset,mode) {
  const now=Math.floor(Date.now()/1000),id=mode+':'+randomBytes(8).toString('hex');
  const manifest=buildRewardManifest({cycleId:randomBytes(32).toString('hex'),asset,
    allocations:recipients.map(k=>({recipient:k.publicKey.toBase58(),amount:'10000'}))});
  const plan={id,cluster:'devnet',kind:'holder',mint,asset,cutoffAt:now-2,payoutAt:now-1,
    manifest,status:'prepared',payments:{},periodStart:now-3};state.schedules[id]=plan;
  const started=Date.now();await scheduler.execute(now,mode==='single'?[id]:null);
  assert.equal(plan.status,'paid',JSON.stringify(plan.payments));
  const signatures=[...new Set(Object.values(plan.payments).map(p=>p.signature))];
  let fees=0,rent=0;
  for(const signature of signatures) {
    const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    assert.equal(tx.meta.err,null);assert.equal(tx.transaction.message.header.numRequiredSignatures,1);
    const keys=(tx.transaction.message.accountKeys||tx.transaction.message.staticAccountKeys).map(k=>k.toBase58());
    assert.equal(keys[0],authority.publicKey.toBase58());fees+=tx.meta.fee;
    const entries=Object.entries(plan.payments).filter(([,p])=>p.signature===signature);
    let receiptRent=0;
    for(const [recipient,payment]of entries) {
      const record=await chain.inspectLeaf(plan,manifest.leaves.find(leaf=>leaf.recipient===recipient));
      assert.equal(record.amountReceived,'10000');assert.equal(record.payment,payment.payment);
      const p=keys.indexOf(payment.payment);assert.equal(tx.meta.preBalances[p],0);receiptRent+=tx.meta.postBalances[p];
      if(asset==='SOL'){const i=keys.indexOf(recipient);assert.equal(tx.meta.postBalances[i]-tx.meta.preBalances[i],10000);}
      else {const ata=getAssociatedTokenAddressSync(new PublicKey(asset),new PublicKey(recipient)).toBase58(),i=keys.indexOf(ata);
        const before=tx.meta.preTokenBalances.find(x=>x.accountIndex===i),after=tx.meta.postTokenBalances.find(x=>x.accountIndex===i);
        assert.equal(BigInt(after.uiTokenAmount.amount)-BigInt(before?.uiTokenAmount.amount||0),10000n);}
    }
    const vault=rewardAddresses({programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority:authority.publicKey,mint}).vault;
    if(asset==='SOL'){const v=keys.indexOf(vault.toBase58());assert.equal(tx.meta.preBalances[v]-tx.meta.postBalances[v],10000*entries.length);}
    rent+=receiptRent;
    emit({type:'payout-proof',mode,asset,mint,signature,slot:tx.slot,feeLamports:tx.meta.fee,receiptRentLamports:receiptRent,
      recipients:entries.map(([recipient,p])=>({recipient,amount:p.amount,payment:p.payment})),
      feePayer:keys[0],requiredSigners:1,digest:createHash('sha256').update(tx.transaction.message.serialize()).digest('hex'),
      finalized:true,balanceDeltaVerified:true});
  }
  const retry=await scheduler.execute(now,mode==='single'?[id]:null);
  assert.equal(retry.submitted,0);
  const summary={type:'case',mode,asset,mint,recipients:4,transactions:signatures.length,feeLamports:fees,
    receiptRentLamports:rent,elapsedMs:Date.now()-started,retrySubmitted:retry.submitted,recipientFees:0};
  summaries.push(summary);emit(summary);
}
try {
  const funding=await sendAndConfirmSigned(connection,new Transaction().add(
    SystemProgram.transfer({fromPubkey:keeper.publicKey,toPubkey:qa.publicKey,lamports:30000000}),
    ...recipients.map(k=>SystemProgram.transfer({fromPubkey:keeper.publicKey,toPubkey:k.publicKey,lamports:1000000}))),[keeper],{commitment:'finalized'});
  emit({type:'fixture-funded',signature:funding,lamports:34000000,wallets:[qa,...recipients].map(k=>k.publicKey.toBase58()),build:process.env.FUNDED_BUILD_ID});
  const mint=Keypair.generate().publicKey.toBase58();await chain.fundSolVault({mint,amount:'80000'});
  await run(mint,'SOL','single');await run(mint,'SOL','batch');
  tokenMint=await createMint(connection,qa,qa.publicKey,null,6,undefined,{commitment:'finalized'});
  const vault=await chain.ensureVault(tokenMint.toBase58());
  const account=await getOrCreateAssociatedTokenAccount(connection,qa,tokenMint,vault,true,'finalized',{commitment:'finalized'});
  await mintTo(connection,qa,tokenMint,account.address,qa,80000,[],{commitment:'finalized'});
  await run(tokenMint.toBase58(),tokenMint.toBase58(),'single');await run(tokenMint.toBase58(),tokenMint.toBase58(),'batch');
  for(const asset of ['SOL',tokenMint.toBase58()]) {
    const single=summaries.find(r=>r.asset===asset&&r.mode==='single'),batch=summaries.find(r=>r.asset===asset&&r.mode==='batch');
    assert(batch.feeLamports<single.feeLamports);assert.equal(batch.receiptRentLamports,single.receiptRentLamports);
    emit({type:'fee-savings',asset,singleFeeLamports:single.feeLamports,batchFeeLamports:batch.feeLamports,
      savedLamports:single.feeLamports-batch.feeLamports,savedPercent:100*(single.feeLamports-batch.feeLamports)/single.feeLamports,
      receiptRentUnchanged:true});
  }
} finally {
  const failures=[];
  for(const kp of [...recipients,qa]) {
    try {
      if(tokenMint&&kp!==qa) {
        const ata=getAssociatedTokenAddressSync(tokenMint,kp.publicKey),info=await connection.getAccountInfo(ata,'finalized');
        if(info){const amount=(await connection.getTokenAccountBalance(ata,'finalized')).value.amount;
          await sendAndConfirmTransaction(connection,new Transaction().add(
            ...(BigInt(amount)>0n?[createBurnInstruction(ata,tokenMint,kp.publicKey,BigInt(amount))]:[]),
            createCloseAccountInstruction(ata,kp.publicKey,kp.publicKey)),[kp],{commitment:'finalized'});}
      }
      const balance=await connection.getBalance(kp.publicKey,'finalized');
      if(balance>5000){const signature=await sendAndConfirmTransaction(connection,new Transaction().add(
        SystemProgram.transfer({fromPubkey:kp.publicKey,toPubkey:keeper.publicKey,lamports:balance-5000})),[kp],{commitment:'finalized'});
        emit({type:'refund',wallet:kp.publicKey.toBase58(),signature,balance:await connection.getBalance(kp.publicKey,'finalized')});}
    } catch(error){failures.push(kp.publicKey.toBase58());emit({type:'cleanup-error',wallet:kp.publicKey.toBase58(),message:error.message});}
  }
  assert.equal(failures.length,0,'Fixture cleanup incomplete');
}
