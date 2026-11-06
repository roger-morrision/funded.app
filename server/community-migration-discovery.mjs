import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {verifyPumpMigrationTransaction} from './community-snapshot.mjs';

// Batch the pending canonical pools. Absence is rechecked each pass; a pool
// already present 256 finalized slots ago cannot be a fresh migration.
export function createMigrationCandidateReader(){
  const firstSeen=new Map();
  return async(connection,mints)=>{
    const candidates=new Map();
    for(let i=0;i<mints.length;i+=90){
      const batch=mints.slice(i,i+90),keys=batch.map(m=>canonicalPumpPoolPda(new PublicKey(m),NATIVE_MINT));
      const {context,value}=await connection.getMultipleAccountsInfoAndContext(keys,{commitment:'finalized',dataSlice:{offset:0,length:0}});
      if(!Number.isSafeInteger(context?.slot)||context.slot<=0||value.length!==batch.length)throw Error('Incomplete finalized migration pool scan.');
      batch.forEach((mint,j)=>{
        if(!value[j]?.owner.equals(PUMP_AMM_PROGRAM_ID))return;
        if(!firstSeen.has(mint))firstSeen.set(mint,context.slot);
        if(context.slot-firstSeen.get(mint)<=256)candidates.set(mint,context.slot);
      });
    }
    return candidates;
  };
}
export async function findRecentCommunityMigration(connection,mint,observedSlot) {
  const launchMint=new PublicKey(mint),pool=canonicalPumpPoolPda(launchMint,NATIVE_MINT);
  const currentSlot=observedSlot??await connection.getSlot('finalized');
  let before;
  for(let page=0;page<3;page++){
    const signatures=await connection.getSignaturesForAddress(pool,{limit:100,...(before?{before}:{})},'finalized');
    for(const row of signatures){
      if(row.slot<currentSlot-256)return null;
      if(row.err)continue;
      const transaction=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
      if(!transaction?.transaction?.signatures?.includes(row.signature))continue;
      try{verifyPumpMigrationTransaction({transaction,launchMint});return row.signature;}catch{}
    }
    if(signatures.length<100)break;
    before=signatures.at(-1).signature;
  }
  return null;
}
