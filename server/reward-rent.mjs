import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
export const rewardDiscriminator = (space,name) => createHash('sha256').update(`${space}:${name}`).digest().subarray(0,8);
export const MAX_BITMAP_LEAVES = 65536;

export function rewardBitmap(account) {
  const data=Buffer.from(account?.data||[]);
  if(data.length<178||!data.subarray(0,8).equals(rewardDiscriminator('account','RewardBitmapCycle')))return null;
  const count=data.readUInt32LE(168),bytes=data.readUInt32LE(174);
  if(!count||count>MAX_BITMAP_LEAVES||bytes!==Math.ceil(count/8)||data.length!==178+bytes)
    throw new Error('Invalid reward bitmap layout.');
  return data.subarray(178);
}
export const bitmapPaid=(bitmap,index)=>Number.isSafeInteger(index)&&index>=0&&index<bitmap.length*8
  &&(bitmap[Math.floor(index/8)]&(1<<(index%8)))!==0;

// Cleanup is deliberately bounded and only operates on archived, fully paid
// legacy schedules. The retained cycle account permanently rejects replays.
export function rewardReceiptCleanup({cluster,connection,program,authority,legacyRouter,addresses,parseCycle,requireReady,send,verifyArchive}) {
  return async plan=>{
    if(cluster!=='devnet')throw new Error('Reward receipt cleanup is Devnet only.');
    await requireReady(plan);
    const {vault,cycle}=addresses(plan);
    const info=await connection.getAccountInfo(cycle,'finalized'),saved=parseCycle(info);
    if(!info?.owner.equals(program)||!saved||saved.root!==plan.manifest.root||saved.cycleId!==plan.manifest.cycleId
      ||saved.vault!==vault.toBase58()||saved.totalAmount!==plan.manifest.totalAmount)
      throw new Error('Cleanup cycle differs from its frozen manifest.');
    if(rewardBitmap(info))return {complete:true,bitmap:true,refundLamports:'0'};
    if(saved.distributedAmount!==saved.totalAmount)throw new Error('Cleanup requires a fully paid cycle.');
    if(!plan.manifest.leaves.every(leaf=>{
      const paid=plan.payments?.[leaf.recipient];return (paid?.status==='paid'||paid?.finalized===true)
        &&paid.balanceDeltaVerified===true&&paid.signature&&paid.amount===leaf.amount;
    }))throw new Error('Archive every finalized payment signature before reclaiming receipts.');
    const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
    const ix=(name,keys)=>new TransactionInstruction({programId:program,data:rewardDiscriminator('global',name),keys});
    const tx=new Transaction();
    if(saved.reserved)tx.add(ix('complete_reward_cycle',[key(authority.publicKey,false,true),key(vault),key(cycle,true),key(legacyRouter)]));
    const accounts=[];
    for(const leaf of plan.manifest.leaves){
      const payment=addresses(plan,leaf).payment,info=await connection.getAccountInfo(payment,'finalized');
      if(!info)continue;
      const data=Buffer.from(info.data);
      if(!info.owner.equals(program)||data.length!==100||!data.subarray(0,8).equals(rewardDiscriminator('account','RewardPayment'))
        ||!data.subarray(8,40).equals(cycle.toBuffer())||!data.subarray(40,72).equals(new PublicKey(leaf.recipient).toBuffer())
        ||data.readBigUInt64LE(72)!==BigInt(leaf.amount)||data.readUInt32LE(80)!==leaf.index)
        throw new Error('Cleanup payment differs from its frozen entitlement.');
      const archive=await verifyArchive(plan,leaf,plan.payments[leaf.recipient].signature);
      if(!archive||archive.feePayer!==authority.publicKey.toBase58())throw new Error('Only verified app-sponsored receipts may be reclaimed.');
      accounts.push({payment,lamports:info.lamports});
      tx.add(ix('close_reward_payment',[key(authority.publicKey,true,true),key(vault),key(cycle),key(payment,true),key(legacyRouter)]));
      if(accounts.length===4)break;
    }
    if(!tx.instructions.length)return {complete:true,refundLamports:'0'};
    const signature=await send(tx),proof=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    const after=parseCycle(await connection.getAccountInfo(cycle,'finalized'));
    if(!proof||proof.meta?.err!==null||!after||after.reserved)throw new Error('Cleanup has no finalized closed-cycle proof.');
    const keys=(proof.transaction.message.accountKeys||proof.transaction.message.staticAccountKeys).map(k=>k.toBase58());
    const refund=accounts.reduce((sum,a)=>sum+BigInt(a.lamports),0n),payer=keys.indexOf(authority.publicKey.toBase58());
    if(payer!==0||BigInt(proof.meta.postBalances[payer])-BigInt(proof.meta.preBalances[payer])!==refund-BigInt(proof.meta.fee))
      throw new Error('Cleanup lacks exact app refund evidence.');
    for(const {payment}of accounts)if(await connection.getAccountInfo(payment,'finalized'))throw new Error('Receipt remains open after cleanup.');
    return {complete:false,signature,refundLamports:String(refund),feeLamports:proof.meta.fee,closed:accounts.map(a=>a.payment.toBase58()),finalized:true};
  };
}

export async function cleanupPaidSchedules({store,chain,limit=1}) {
  if(chain.cluster!=='devnet'||!chain.cleanupReceipts)return;
  const plans=await store.transaction(state=>structuredClone(Object.values(state.schedules||{}).filter(p=>p.status==='paid'&&!p.receiptCleanup?.complete
    &&(!p.receiptCleanup?.retryAfter||Date.now()>=p.receiptCleanup.retryAfter)).slice(0,limit)));
  for(const plan of plans)try{
    const result=await chain.cleanupReceipts(plan);
    await store.transaction(state=>{const p=state.schedules[plan.id];p.receiptCleanup={...result,
      transactions:[...(p.receiptCleanup?.transactions||[]),...(result.signature?[result]:[])]};});
  }catch(error){await store.transaction(state=>{const p=state.schedules[plan.id];p.receiptCleanup={...p.receiptCleanup,error:String(error.message),retryAfter:Date.now()+300000};});}
}

export async function cleanupDailyReceipts({rewardStore,readLedger,chain,cluster}) {
  if(cluster!=='devnet'||!chain.cleanupReceipts)return;
  const ledger=await readLedger();
  for(const [day,snapshot]of Object.entries(ledger.dailyBonusSnapshots||{}))for(const [id,payout]of Object.entries(snapshot.payouts||{})){
    if(payout.status!=='paid'||payout.receiptCleanup?.complete||Date.now()<(payout.receiptCleanup?.retryAfter||0))continue;
    const source=snapshot.snapshot.sources.find(s=>s.collectionSignature===id);if(!source)continue;
    try{
      const result=await chain.cleanupReceipts({cluster,mint:source.mint,cutoffAt:snapshot.snapshot.end,payoutAt:payout.payoutAt??snapshot.snapshot.end,
        manifest:payout.manifest,payments:payout.payments});
      await rewardStore.transaction(state=>{const p=state.dailyBonusSnapshots[day].payouts[id];p.receiptCleanup={...result,
        transactions:[...(p.receiptCleanup?.transactions||[]),...(result.signature?[result]:[])]};});
    }catch(error){await rewardStore.transaction(state=>{const p=state.dailyBonusSnapshots[day].payouts[id];p.receiptCleanup={...p.receiptCleanup,error:String(error.message),retryAfter:Date.now()+300000};});}
    return; // At most one cycle and four receipt closes per execution.
  }
}
