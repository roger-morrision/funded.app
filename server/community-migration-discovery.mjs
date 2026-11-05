import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {verifyPumpMigrationTransaction} from './community-snapshot.mjs';

export async function findRecentCommunityMigration(connection,mint) {
  const launchMint=new PublicKey(mint),pool=canonicalPumpPoolPda(launchMint,NATIVE_MINT);
  const currentSlot=await connection.getSlot('finalized');
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
