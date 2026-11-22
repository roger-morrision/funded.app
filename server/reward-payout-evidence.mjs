import {PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {verifyRewardProof} from '../reward-merkle.js';
import {rewardDiscriminator} from './reward-rent.mjs';

// A shared cycle has many signatures. Never use the oldest cycle signature as
// a payout receipt: decode the exact leaf and finalized transfer evidence.
export function rewardPayoutProof(tx,{program,cycle,vault,manifest,leaf,bitmap}) {
  if(!tx||tx.meta?.err!==null)return null;
  const keys=[...(tx.transaction.message.accountKeys||tx.transaction.message.staticAccountKeys),
    ...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(k=>k.toBase58());
  const sol=manifest.asset==='SOL',name=bitmap?(sol?'payout_bitmap_sol':'payout_bitmap_token'):(sol?'payout_reward_sol':'payout_reward_token');
  const instructions=tx.transaction.message.instructions||tx.transaction.message.compiledInstructions;
  const matches=[];let total=0n;const seen=new Set();let target;
  for(const ix of instructions){
    if(keys[ix.programIdIndex]!==String(program))continue;
    const accounts=Array.from(ix.accounts||ix.accountKeyIndexes,i=>keys[i]);
    if(accounts[3]!==String(cycle))continue;
    const data=Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data);
    if(data.length<24||!data.subarray(0,8).equals(rewardDiscriminator('global',name)))return null;
    const index=data.readUInt32LE(16),n=data.readUInt32LE(20);
    if(n>32||data.length!==24+n*32)return null;
    const other=manifest.leaves.find(l=>l.index===index&&l.recipient===accounts[4]);
    if(!other||seen.has(index)||data.readBigUInt64LE(8)!==BigInt(other.amount)||accounts[1]!==String(vault))return null;
    const proof=Array.from({length:n},(_,i)=>data.subarray(24+i*32,56+i*32).toString('hex'));
    if(!verifyRewardProof({cycleId:manifest.cycleId,asset:manifest.asset,...other,proof,root:manifest.root}))return null;
    seen.add(index);total+=BigInt(other.amount);matches.push(other);
    if(index===leaf.index&&other.recipient===leaf.recipient)target=accounts;
  }
  if(!target||!matches.length)return null;
  const delta=address=>{const i=keys.indexOf(String(address));return i<0?null:BigInt(tx.meta.postBalances[i])-BigInt(tx.meta.preBalances[i]);};
  const tokenDelta=address=>{const i=keys.indexOf(String(address)),before=tx.meta.preTokenBalances?.find(r=>r.accountIndex===i&&r.mint===manifest.asset),after=tx.meta.postTokenBalances?.find(r=>r.accountIndex===i&&r.mint===manifest.asset);
    return !after?null:BigInt(after.uiTokenAmount.amount)-BigInt(before?.uiTokenAmount.amount||0);};
  if(sol){
    if(delta(vault)!==-total)return null;
    if(keys[0]===leaf.recipient){
      // Single receipt-mode self-payment also pays its exact new receipt rent
      // and transaction fee. No other native movements may subsidize the credit.
      const payment=target[5],i=keys.indexOf(payment),rent=delta(payment);
      if(bitmap||matches.length!==1||i<0||tx.meta.preBalances[i]!==0||rent<=0n
        ||!Number.isSafeInteger(tx.meta.fee)||tx.meta.fee<=0
        ||keys.some(k=>![String(vault),leaf.recipient,payment].includes(k)&&delta(k)!==0n)
        ||delta(leaf.recipient)!==BigInt(leaf.amount)-BigInt(tx.meta.fee)-rent)return null;
    }else if(delta(leaf.recipient)!==BigInt(leaf.amount))return null;
  }
  else{
    const tokenProgram=new PublicKey(target[bitmap?8:9]),mint=new PublicKey(manifest.asset);
    if(target[5]!==manifest.asset||target[6]!==getAssociatedTokenAddressSync(mint,new PublicKey(vault),true,tokenProgram).toBase58()
      ||target[7]!==getAssociatedTokenAddressSync(mint,new PublicKey(leaf.recipient),false,tokenProgram).toBase58()
      ||tokenDelta(target[6])!==-total||tokenDelta(target[7])!==BigInt(leaf.amount))return null;
  }
  return {signature:tx.transaction.signatures[0],finalized:true,balanceDeltaVerified:true,amount:leaf.amount,amountReceived:leaf.amount,
    slot:tx.slot,blockTime:tx.blockTime,feeLamports:tx.meta.fee,feePayer:keys[0]};
}

export async function findRewardPayout(connection,context,preferredSignature=null) {
  if(preferredSignature){
    const proof=rewardPayoutProof(await connection.getTransaction(preferredSignature,{commitment:'finalized',maxSupportedTransactionVersion:0}),context);
    if(proof)return proof;
  }
  let before;
  for(let page=0;page<3;page++){
    const rows=await connection.getSignaturesForAddress(new PublicKey(context.bitmap?context.cycle:context.payment),{limit:100,...(before?{before}:{})},'finalized');
    for(const row of rows.filter(r=>!r.err)){
      const proof=rewardPayoutProof(await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),context);
      if(proof)return proof;
    }
    if(rows.length<100)break;before=rows.at(-1).signature;
  }
  throw new Error('Finalized payout evidence unavailable; do not resend or mark a new payment.');
}
