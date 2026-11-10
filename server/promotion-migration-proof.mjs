import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {assertRpcNetwork} from '../solana-network.js';
import {verifyPumpMigrationTransaction} from './community-snapshot.mjs';

export async function verifyMigrationEmailProof({connection,cluster,mint,signature}) {
  await assertRpcNetwork(connection,cluster);
  const transaction=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!transaction?.transaction?.signatures?.includes(signature))throw Error('Migration signature mismatch.');
  const result=verifyPumpMigrationTransaction({transaction,launchMint:new PublicKey(mint)});
  const account=await connection.getAccountInfo(result.pool,'finalized');
  if(!account?.owner.equals(PUMP_AMM_PROGRAM_ID))throw Error('Canonical migrated pool is unavailable.');
  return {mint,cluster,signature,slot:result.slot,verified:true,commitment:'finalized'};
}

// Persist the pagination cursor between passes: a restart or busy pool must not
// permanently hide the migration receipt. Work is bounded to 20 receipts/pass.
export async function discoverMigrationEmailProof({connection,cluster,mint,launchSlot,before}) {
  await assertRpcNetwork(connection,cluster);
  const pool=canonicalPumpPoolPda(new PublicKey(mint),NATIVE_MINT);
  const account=await connection.getAccountInfo(pool,'finalized');
  if(!account?.owner.equals(PUMP_AMM_PROGRAM_ID))return {before:null};
  const rows=await connection.getSignaturesForAddress(pool,{limit:20,...(before?{before}:{})},'finalized');
  for(const row of rows){
    if(row.slot<=launchSlot)return {before:null};
    if(row.err)continue;
    // Transport failures retry the same page; invalid on-chain receipts are skipped.
    const transaction=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if(!transaction)throw Error('Finalized migration candidate is unavailable.');
    if(!transaction.transaction?.signatures?.includes(row.signature))throw Error('Migration candidate signature mismatch.');
    try{
      const result=verifyPumpMigrationTransaction({transaction,launchMint:new PublicKey(mint)});
      return {proof:{mint,cluster,signature:row.signature,slot:result.slot,verified:true,commitment:'finalized'}};
    }catch{/* A successful trade is not a migration event. */}
  }
  return {before:rows.length===20?rows.at(-1).signature:null};
}
