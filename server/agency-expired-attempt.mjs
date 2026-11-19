import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';

// Own-coin milestones have a fixed immutable receipt PDA. Do not infer a
// failed send from an RPC exception or a missing signature status alone.
export async function expiredAgencyAttempt(connection,row){
  if(![1,2].includes(row.intent?.agent)||!row.signature||!row.signedTransaction
    ||!Number.isSafeInteger(row.lastValidBlockHeight)||row.lastValidBlockHeight<1)return null;
  const expired=await connection.isBlockhashValid(row.blockhash,{commitment:'finalized'});
  if(expired.value!==false||!Number.isSafeInteger(expired.context?.slot)||expired.context.slot<1)return null;
  const height=await connection.getBlockHeight({commitment:'finalized',minContextSlot:expired.context.slot});
  if(!Number.isSafeInteger(height)||height<=row.lastValidBlockHeight+150)return null;
  if(await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}))return null;
  const id=createHash('sha256').update(`funded.agency.own-coin.v1:${row.intent.mint}:${row.intent.agent}`).digest();
  const receipt=PublicKey.findProgramAddressSync([Buffer.from('mint-buyback-v3'),new PublicKey(row.intent.mint).toBuffer(),id],
    new PublicKey(row.intent.programId))[0];
  const account=await connection.getAccountInfoAndContext(receipt,{commitment:'finalized',minContextSlot:expired.context.slot});
  if(account.value!==null||!Number.isSafeInteger(account.context?.slot)||account.context.slot<expired.context.slot)return null;
  return {finalizedHeight:height,expirySlot:expired.context.slot,receipt:String(receipt),receiptSlot:account.context.slot};
}
