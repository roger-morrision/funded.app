import bs58 from 'bs58';
import {createHash} from 'node:crypto';

// Persist the exact signed identity before the first network submission. A
// timeout or process restart can then reconcile that identity without signing
// a second collection. The durable callback must succeed before any broadcast.
export async function sendJournaledCollection(connection,transaction,signers,{
 onSigned,maxPolls=60,pollDelayMs=1500,
}={}){
 if(typeof onSigned!=='function'||!Number.isSafeInteger(transaction.lastValidBlockHeight))
  throw Error('A durable collection journal and bounded blockhash are required.');
 transaction.sign(...signers);
 const wire=transaction.serialize(),signature=bs58.encode(transaction.signature);
 await onSigned({signature,blockhash:transaction.recentBlockhash,lastValidBlockHeight:transaction.lastValidBlockHeight,
  wireHash:createHash('sha256').update(wire).digest('hex')});
 let cause;
 try{
  const sent=await connection.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2});
  if(sent!==signature)throw Error('RPC returned a different collection signature.');
 }catch(error){cause=error;}
 for(let poll=0;poll<maxPolls;poll++){
  try{
   const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
   if(status?.confirmationStatus==='finalized'){
    if(status.err)throw Object.assign(Error('Collection failed on chain; retain its signed identity for review.'),{pendingSignature:signature});
    return signature;
   }
   if(!status&&await connection.getBlockHeight('confirmed')>transaction.lastValidBlockHeight)break;
  }catch(error){if(error.pendingSignature)throw error;cause=error;}
  if(poll+1<maxPolls)await new Promise(resolve=>setTimeout(resolve,pollDelayMs));
 }
 throw Object.assign(Error('Collection finality is pending; reconcile the recorded signature before retry.',{cause}),{pendingSignature:signature});
}
