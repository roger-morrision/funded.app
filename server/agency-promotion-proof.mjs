import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {ComputeBudgetProgram,PublicKey} from '@solana/web3.js';
import {buildAgencyPromotionV3Instruction,agencyDiscriminator} from '../agency-mint-router-v3.js';
import {verifyMintPolicyV3Account} from '../mint-router-v3.js';

export function agencyDeliveryHash(post){
  if(post?.verified!==true||!/^\d{1,20}$/.test(String(post.id))||!/^\d{1,30}$/.test(String(post.authorId))
    ||typeof post.text!=='string'||!post.text.trim()||!Number.isSafeInteger(Date.parse(post.createdAt)))
    throw new Error('An independently verified exact X delivery is required.');
  return createHash('sha256').update(JSON.stringify({id:String(post.id),authorId:String(post.authorId),text:post.text,
    createdAt:new Date(post.createdAt).toISOString()})).digest();
}
const address=value=>typeof value==='string'?value:value?.pubkey?address(value.pubkey):value?.toBase58?.()||'';

// Current X author/text/time and a finalized protected billing receipt are
// separate proofs. Neither a saved outbox result nor a chain hash proves both.
export async function loadFinalizedAgencyPromotion({connection,signature,programId,mint,creator,initialAuthority,authority,
  promotionRecipient,postId,sequence,amount,text,split,verifyDelivery,verifyPolicy=verifyMintPolicyV3Account}){
  try{
    if(typeof verifyDelivery!=='function'||split?.agencyPercent===undefined)return null;
    const delivery=await verifyDelivery({id:String(postId),text});
    if(delivery?.id!==String(postId)||delivery.text!==text)return null;
    const postedAt=Math.floor(Date.parse(delivery.createdAt)/1000),hash=agencyDeliveryHash(delivery);
    const expected=buildAgencyPromotionV3Instruction({programId,mint,authority,promotionRecipient,postId,sequence,amount,postedAt,deliveryHash:hash});
    const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if(!tx||tx.meta?.err!==null||!Number.isSafeInteger(tx.slot)||tx.slot<1||!Number.isSafeInteger(tx.blockTime)
      ||tx.blockTime<postedAt||!tx.transaction.signatures.includes(signature))return null;
    const message=tx.transaction.message,staticKeys=(message.accountKeys||message.staticAccountKeys||[]).map(address);
    const keys=[...staticKeys,...(tx.meta.loadedAddresses?.writable||[]).map(address),...(tx.meta.loadedAddresses?.readonly||[]).map(address)];
    if(staticKeys[0]!==new PublicKey(authority).toBase58()||message.header?.numRequiredSignatures!==1)return null;
    let matched=0;
    for(const ix of message.instructions||message.compiledInstructions||[]){
      if(keys[ix.programIdIndex]===ComputeBudgetProgram.programId.toBase58())continue;
      if(++matched!==1||keys[ix.programIdIndex]!==new PublicKey(programId).toBase58())return null;
      const data=Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data||[]),accounts=Array.from(ix.accounts||ix.accountKeyIndexes||[]);
      if(!data.equals(expected.instruction.data)||accounts.length!==expected.instruction.keys.length
        ||expected.instruction.keys.some((row,i)=>keys[accounts[i]]!==row.pubkey.toBase58()))return null;
    }
    if(matched!==1)return null;
    const[receipt,policy]=await Promise.all([connection.getAccountInfo(expected.receipt,'finalized'),
      verifyPolicy({connection,programId,mint,creator,initialAuthority,split})]);
    const row=Buffer.from(receipt?.data||[]);
    if(!receipt?.owner?.equals(new PublicKey(programId))||receipt.executable||row.length!==140
      ||!row.subarray(0,8).equals(agencyDiscriminator('AgencyPromotionV3'))||!row.subarray(8,40).equals(new PublicKey(mint).toBuffer())
      ||row.readBigUInt64LE(40)!==BigInt(postId)||!row.subarray(48,80).equals(hash)||row.readUInt32LE(80)!==sequence
      ||!row.subarray(84,116).equals(new PublicKey(promotionRecipient).toBuffer())||row.readBigUInt64LE(116)!==BigInt(amount)
      ||row.readBigInt64LE(124)!==BigInt(postedAt)||row.readBigInt64LE(132)!==BigInt(tx.blockTime)
      ||!policy.verified||!policy.agencyPolicy||!(policy.selectedMask&1)||policy.promotionRecipient!==new PublicKey(promotionRecipient).toBase58()
      ||policy.promotionSequence<=sequence||policy.lastPromotionAt<BigInt(postedAt)||policy.agentSpent[0]<BigInt(amount))return null;
    const vi=keys.indexOf(expected.vault.toBase58()),ri=keys.indexOf(new PublicKey(promotionRecipient).toBase58()),pi=keys.indexOf(expected.receipt.toBase58());
    const before=tx.meta.preBalances,after=tx.meta.postBalances,fee=tx.meta.fee;
    if(!Array.isArray(before)||!Array.isArray(after)||before.length!==keys.length||after.length!==keys.length||vi<0||ri<0||pi<0
      ||![before[vi],after[vi],before[ri],after[ri],before[pi],after[pi],fee,receipt.lamports].every(Number.isSafeInteger)
      ||fee<0||before[pi]!==0||after[pi]!==receipt.lamports||BigInt(before[vi])-BigInt(after[vi])!==BigInt(amount))return null;
    const received=BigInt(after[ri])-BigInt(before[ri]),rent=ri===0?BigInt(receipt.lamports):0n;
    if(received!==BigInt(amount)-(ri===0?BigInt(fee)+rent:0n))return null;
    return{signature,mint:new PublicKey(mint).toBase58(),programId:new PublicKey(programId).toBase58(),category:7,agent:0,
      receipt:expected.receipt.toBase58(),recipient:new PublicKey(promotionRecipient).toBase58(),amount:String(amount),
      actualReceivedLamports:String(received),feeLamports:fee,recipientRentLamports:String(rent),feePayer:staticKeys[0],
      slot:tx.slot,blockTime:tx.blockTime,post:delivery,deliveryHash:hash.toString('hex'),finalized:true,balanceDeltaVerified:true};
  }catch{return null;}
}
