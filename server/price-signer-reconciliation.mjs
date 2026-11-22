import {PublicKey} from '@solana/web3.js';
import {verifyConfiguredDevnet} from './configured-devnet-interface.mjs';

// The caller cannot cancel a signature. Only independent finalized chain
// evidence can release its reservation; unavailable or inconsistent RPC stays charged.
export async function unusedPriceReservation(connection,row,{interfaceContext=null}={}){
  try{
    if(interfaceContext){
      if(row.contextHash!==interfaceContext.contextHash||row.programId!==interfaceContext.programId)return null;
      await verifyConfiguredDevnet(connection,interfaceContext,row.programId);
    }
    if(!Number.isSafeInteger(row.slot)||row.slot<1)return null;
    const expired=await connection.isBlockhashValid(row.blockhash,{commitment:'confirmed'});
    if(expired.value!==false||!Number.isSafeInteger(expired.context?.slot)||expired.context.slot<row.slot)return null;
    const rooted=await connection.isBlockhashValid(row.blockhash,{commitment:'finalized',minContextSlot:expired.context.slot});
    if(rooted.value!==false||!Number.isSafeInteger(rooted.context?.slot)||rooted.context.slot<expired.context.slot)return null;
    const receipt=await connection.getAccountInfoAndContext(new PublicKey(row.receipt),
      {commitment:'finalized',minContextSlot:rooted.context.slot});
    if(receipt.value!==null||!Number.isSafeInteger(receipt.context?.slot)||receipt.context.slot<rooted.context.slot)return null;
    return {expirySlot:rooted.context.slot,receiptSlot:receipt.context.slot};
  }catch{return null;}
}
