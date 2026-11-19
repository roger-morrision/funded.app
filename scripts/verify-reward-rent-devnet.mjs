// Run inside the accepted funded.vip Devnet app container. No private keys or
// cookies are written: disposable wallets live only for this process lifetime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync,
  createBurnInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import { createRemoteSigner } from '../server/remote-signer.mjs';
import { sendAndConfirmSigned } from '../server/transaction-signing.mjs';
import { createAutomaticRewardChain, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import {parseCycleFields} from '../server/reward-account-codec.mjs';
import {bitmapPaid} from '../server/reward-rent.mjs';
import {findRewardPayout} from '../server/reward-payout-evidence.mjs';
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
if(process.env.REWARD_BATCH_PRIMARY_EVIDENCE==='true')process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL='';
const rateLimited=error=>/429|rate limit|too many requests/i.test(String(error?.message||error));
async function retryRead(read) {
  for(let attempt=0;;attempt++)try{return await read();}catch(error){
    if(!rateLimited(error)||attempt>=6)throw error;
    emit({type:'evidence-retry',attempt:attempt+1});await new Promise(resolve=>setTimeout(resolve,30000));
  }
}
const remote=createRemoteSigner(),authority=remote.handle('authority'),keeper=remote.handle('keeper');
assert(authority&&keeper);assert(await connection.getBalance(authority.publicKey)>200000000);
const chain=createAutomaticRewardChain({connection,programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority,
  expectedProgramDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256,cluster:'devnet'});
assert.equal((await retryRead(()=>chain.readiness())).constrainedPayouts,true);
const recipients=Array.from({length:4},()=>Keypair.generate()),qa=Keypair.generate();
const batchOnly=false;
const tokenOnly=false;
let tokenMint;
const state={schedules:{},programs:{}},store={transaction:async fn=>fn(state),read:async()=>structuredClone(state)};
const scheduler=createRewardScheduler({store,chain,indexer:{},cluster:'devnet'});
const summaries=[];const plans=[];
async function run(mint,asset,mode) {
  const now=Math.floor(Date.now()/1000),id=mode+':'+randomBytes(8).toString('hex');
  const manifest=buildRewardManifest({cycleId:randomBytes(32).toString('hex'),asset,
    allocations:recipients.map(k=>({recipient:k.publicKey.toBase58(),amount:'10000'}))});
  const plan={id,cluster:'devnet',kind:'holder',mint,asset,cutoffAt:now-2,payoutAt:now-1,
    manifest,status:'prepared',payments:{},periodStart:now-3};state.schedules[id]=plan;plans.push(plan);
  const started=Date.now();
  for(let attempt=0;attempt<7;attempt++){
    await retryRead(()=>scheduler.execute(now,mode==='single'?[id]:null));
    if(plan.status==='paid')break;
    const pending=Object.values(plan.payments).filter(row=>row.status!=='paid');
    if(!pending.length||pending.some(row=>!rateLimited(row.reason)))break;
    emit({type:'worker-retry',mode,asset,attempt:attempt+1});await new Promise(resolve=>setTimeout(resolve,30000));
  }
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
      const record=await retryRead(()=>chain.inspectLeaf(plan,manifest.leaves.find(leaf=>leaf.recipient===recipient)));
      assert.equal(record.amountReceived,'10000');assert.equal(record.payment,payment.payment);
      const p=keys.indexOf(payment.payment);
      if(payment.bitmap){assert.equal(plan.receiptMode,'bitmap');assert.equal(tx.meta.postBalances[p],tx.meta.preBalances[p]);}
      else {assert.equal(tx.meta.preBalances[p],0);receiptRent+=tx.meta.postBalances[p];}
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
      feePayer:keys[0],requiredSigners:1,bitmap:plan.receiptMode==='bitmap',digest:createHash('sha256').update(tx.transaction.message.serialize()).digest('hex'),
      finalized:true,balanceDeltaVerified:true});
  }
  const retry=await retryRead(()=>scheduler.execute(now,mode==='single'?[id]:null));
  assert.equal(retry.submitted,0);
  const summary={type:'case',mode,asset,mint,recipients:4,transactions:signatures.length,feeLamports:fees,
    receiptRentLamports:rent,elapsedMs:Date.now()-started,retrySubmitted:retry.submitted,recipientFees:0};
  const addresses=rewardAddresses({programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority:authority.publicKey,mint,cycleId:manifest.cycleId});
  const cycleInfo=await connection.getAccountInfo(addresses.cycle,'finalized');
  summary.cycleRentLamports=cycleInfo.lamports;summary.cycleBytes=cycleInfo.data.length;
  summaries.push(summary);emit(summary);
  if(mode==='single'){
    const cleanup=await retryRead(()=>chain.cleanupReceipts(plan));assert(cleanup.finalized);assert.equal(cleanup.refundLamports,String(rent));emit({type:'cleanup',asset,cycle:addresses.cycle.toBase58(),...cleanup});
    const closed=parseCycleFields(await connection.getAccountInfo(addresses.cycle,'finalized'));assert.equal(closed.reserved,false);
    await assert.rejects(chain.ensureCycle(plan),/unrecognized/);
    const archived=await retryRead(()=>chain.inspectLeaf(plan,manifest.leaves[0]));assert(archived.reclaimed&&archived.finalized);
    emit({type:'archived-proof',asset,signature:archived.signature,reclaimed:true});
  }else{
    const saved=parseCycleFields(cycleInfo);assert(saved.bitmap);for(const leaf of manifest.leaves)assert(bitmapPaid(saved.bitmap,leaf.index));
    const recovered=await retryRead(()=>chain.submitLeaves({...plan,payments:{}},[manifest.leaves[0]]));
    assert(recovered[0].result?.alreadyPaid);assert(recovered[0].result.signature);emit({type:'crash-recovery',asset,signature:recovered[0].result.signature,alreadyPaid:true});
    for(const leaf of manifest.leaves){const p=rewardAddresses({programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority:authority.publicKey,mint,cycleId:manifest.cycleId,recipient:leaf.recipient}).payment;
      assert.equal(await connection.getAccountInfo(p,'finalized'),null);}
  }
  await rejectReplay(signatures[0],asset,mode,addresses.vault);

}
async function rejectReplay(signature,asset,mode,vault){
  const prior=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  const message=prior.transaction.message,keys=message.accountKeys;
  const transaction=new Transaction();
  for(const ix of message.instructions){
    if(keys[ix.programIdIndex].toBase58()!==process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)continue;
    transaction.add(new TransactionInstruction({programId:keys[ix.programIdIndex],data:Buffer.from((await import('bs58')).default.decode(ix.data)),
      keys:ix.accounts.map((i,j)=>({pubkey:j===0?qa.publicKey:keys[i],isSigner:j===0,isWritable:message.isAccountWritable(i)}))}));
  }
  assert(transaction.instructions.length);
  const before=asset==='SOL'?await connection.getBalance(vault,'finalized'):(await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(asset),vault,true),'finalized')).value.amount;
  const latest=await connection.getLatestBlockhash('finalized');transaction.recentBlockhash=latest.blockhash;transaction.feePayer=qa.publicKey;transaction.sign(qa);
  const failed=await connection.sendRawTransaction(transaction.serialize(),{skipPreflight:true,maxRetries:2});
  const status=await connection.confirmTransaction({...latest,signature:failed},'finalized');assert(status.value.err);
  const proof=await connection.getTransaction(failed,{commitment:'finalized',maxSupportedTransactionVersion:0});assert(proof.meta.err);
  const after=asset==='SOL'?await connection.getBalance(vault,'finalized'):(await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(asset),vault,true),'finalized')).value.amount;
  assert.equal(after,before);emit({type:'replay-rejected',mode,asset,signature:failed,error:proof.meta.err,vaultUnchanged:true,finalized:true});
}
try {
  const funding=await sendAndConfirmSigned(connection,new Transaction().add(
    SystemProgram.transfer({fromPubkey:keeper.publicKey,toPubkey:qa.publicKey,lamports:30000000}),
    ...recipients.map(k=>SystemProgram.transfer({fromPubkey:keeper.publicKey,toPubkey:k.publicKey,lamports:1000000}))),[keeper],{commitment:'finalized'});
  emit({type:'fixture-funded',signature:funding,lamports:34000000,wallets:[qa,...recipients].map(k=>k.publicKey.toBase58()),build:process.env.FUNDED_BUILD_ID});
  if(!tokenOnly){
    const mint=Keypair.generate().publicKey.toBase58();await chain.fundSolVault({mint,amount:batchOnly?'40000':'80000'});
    if(!batchOnly)await run(mint,'SOL','single');await run(mint,'SOL','batch');
  }
  tokenMint=await createMint(connection,qa,qa.publicKey,null,6,undefined,{commitment:'finalized'});
  const vault=await retryRead(()=>chain.ensureVault(tokenMint.toBase58()));
  const account=await getOrCreateAssociatedTokenAccount(connection,qa,tokenMint,vault,true,'finalized',{commitment:'finalized'});
  await mintTo(connection,qa,tokenMint,account.address,qa,batchOnly?40000:80000,[],{commitment:'finalized'});
  if(!batchOnly)await run(tokenMint.toBase58(),tokenMint.toBase58(),'single');await run(tokenMint.toBase58(),tokenMint.toBase58(),'batch');
  for(const asset of batchOnly?[]:tokenOnly?[tokenMint.toBase58()]:['SOL',tokenMint.toBase58()]) {
    const single=summaries.find(r=>r.asset===asset&&r.mode==='single'),batch=summaries.find(r=>r.asset===asset&&r.mode==='batch');
    assert(batch.feeLamports<single.feeLamports);assert.equal(batch.receiptRentLamports,0);
    emit({type:'fee-savings',asset,singleFeeLamports:single.feeLamports,batchFeeLamports:batch.feeLamports,
      savedLamports:single.feeLamports-batch.feeLamports,savedPercent:100*(single.feeLamports-batch.feeLamports)/single.feeLamports,
      legacyReceiptRent:single.receiptRentLamports,bitmapReceiptRent:batch.receiptRentLamports,extraCycleRent:batch.cycleRentLamports-single.cycleRentLamports,netRentSaved:single.receiptRentLamports-(batch.cycleRentLamports-single.cycleRentLamports),rentSavedPercent:100*(single.receiptRentLamports-(batch.cycleRentLamports-single.cycleRentLamports))/single.receiptRentLamports});
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
