import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { bonusHash } from './daily-bonus.mjs';

const discriminators=['settle_mint_v3','recover_qa_settlement_v3']
  .map(name=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8));
const address=value=>new PublicKey(value.pubkey||value).toBase58();

// Detect successful settlement calls, including calls absent from the app
// ledger. Unknown finalized settlements block this window; an un-settled
// collection does not. Full source/settlement verification is done below.
export function dailyBonusSettlementReferences(transaction,{programId,mint,policy}){
  const message=transaction.transaction.message;
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),
    ...(transaction.meta.loadedAddresses?.writable||[]),...(transaction.meta.loadedAddresses?.readonly||[])].map(address);
  const results=[];
  for(const ix of message.instructions||message.compiledInstructions||[]){
    if(keys[ix.programIdIndex]!==programId)continue;
    const data=typeof ix.data==='string'?Buffer.from(bs58.decode(ix.data)):Buffer.from(ix.data||[]);
    if(!discriminators.some(value=>data.subarray(0,8).equals(value)))continue;
    const accounts=(ix.accounts||ix.accountKeyIndexes||[]).map(index=>keys[index]);
    if(!accounts.includes(mint)||!accounts.includes(policy))continue;
    if(data.length!==48||data.readBigUInt64LE(40)===0n)throw new Error('Malformed indexed bonus settlement.');
    results.push({claimId:data.subarray(8,40).toString('hex'),amountLamports:data.readBigUInt64LE(40).toString()});
  }
  return results;
}

export async function finalizedBonusSettlementSources({job,state,byMint,programId,connection,
  verifyCollection,loadSettlement,remainingReads}){
  const collections=[];let reads=0;
  for(const reference of Object.values(job.settlements||{})){
    const matches=Object.entries(state.v3Settlements||{}).filter(([,value])=>
      value.mint===reference.mint&&value.settlementSignature===reference.signature&&value.status==='finalized');
    if(matches.length===0)return {complete:false,reason:'Waiting for a finalized settlement to be recorded and attributed.',reads};
    if(matches.length!==1)throw new Error('A bonus settlement has conflicting source attribution.');
    const [source,settled]=matches[0],recorded=state.collections?.[source],launch=byMint.get(reference.mint);
    if(!recorded||!launch)return {complete:false,reason:'Waiting for the settled source collection and creator attribution.',reads};
    if(recorded.signature!==source||recorded.mint!==reference.mint||recorded.scope!=='per-mint-v3'
      ||recorded.cluster!=='devnet'||recorded.programId!==programId||recorded.status!=='collected'
      ||recorded.onchainVerified!==true||recorded.attribution!=='mint-verified'
      ||String(recorded.collectedLamports)!==reference.amountLamports||recorded.claimId!==reference.claimId
      ||settled.collectionSignature!==source||!Array.isArray(settled.referralUpline))
      throw new Error('Indexed bonus settlement conflicts with its recorded source.');
    const fingerprint=bonusHash({reference,recorded,settled});
    let proved=job.verifiedCollections[source];
    if(proved?.fingerprint!==fingerprint){
      if(remainingReads-reads<2)return {complete:false,reason:'Verifying finalized settlement-time bonus coverage.',reads};
      const tx=await connection.getTransaction(source,{commitment:'finalized',maxSupportedTransactionVersion:0});reads++;
      if(!tx||tx.meta?.err!==null||!Number.isSafeInteger(tx.blockTime)||!Number.isSafeInteger(tx.slot)
        ||tx.blockTime>reference.blockTime||tx.slot>reference.slot||!tx.transaction?.signatures?.includes(source))
        throw new Error('Finalized bonus source chronology is unavailable.');
      const collected=await verifyCollection({transaction:tx,signature:source,programId,mint:reference.mint,expectedLamports:reference.amountLamports});
      if(!collected||String(collected.expectedLamports)!==reference.amountLamports
        ||Buffer.from(collected.claimId).toString('hex')!==reference.claimId)
        throw new Error('Finalized bonus source collection proof is unavailable.');
      const proof=await loadSettlement({connection,signature:reference.signature,programId,mint:reference.mint,
        authority:launch.pumpFeeRoute.initialAuthority,creator:launch.creatorWallet,
        claimId:Buffer.from(reference.claimId,'hex'),expectedLamports:reference.amountLamports,split:launch.pumpFeeRoute.protocolSplit});reads++;
      if(!proof||proof.signature!==reference.signature||proof.claimId!==reference.claimId
        ||String(proof.expectedLamports)!==reference.amountLamports||proof.slot!==reference.slot
        ||proof.blockTime!==reference.blockTime)
        throw new Error('Finalized settlement-time bonus proof is unavailable.');
      const referrer=settled.referralUpline[0]||null;
      if(referrer===launch.creatorWallet)throw new Error('Daily bonus self-referral is invalid.');
      proved=job.verifiedCollections[source]={fingerprint,value:{mint:reference.mint,signature:source,
        blockTime:tx.blockTime,slot:tx.slot,settlementSignature:reference.signature,
        settlementBlockTime:reference.blockTime,settlementSlot:reference.slot,creator:launch.creatorWallet,referrer,
        amountLamports:reference.amountLamports,claimId:reference.claimId,finalized:true,
        communityLamports:String(proof.categoryLamports[5]),
        dailyBonusVersion:launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version||null}};
    }
    collections.push(proved.value);
  }
  return {complete:true,collections,reads};
}
