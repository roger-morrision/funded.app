import assert from 'node:assert/strict';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createHash} from 'node:crypto';
import {finalizedProgramContext} from './finalized-program-context.mjs';

const validSlot=(value,minimum)=>Number.isSafeInteger(value)&&value>=minimum;

export function signedTokenSellBytes(base64,row){
  assert(typeof base64==='string'&&base64.length<=1644,'Bounded signed conversion bytes required.');
  const raw=Buffer.from(base64,'base64');assert(raw.length<=1232&&raw.toString('base64')===base64,'Noncanonical signed conversion bytes.');
  const tx=VersionedTransaction.deserialize(raw),message=tx.message.serialize();
  assert(createHash('sha256').update(message).digest('hex')===row.messageHash&&tx.message.header.numRequiredSignatures===2
    &&String(tx.message.staticAccountKeys[0])===row.proofIntent.authority&&String(tx.message.staticAccountKeys[1])===row.proofIntent.priceSigner,
  'Signed conversion differs from durable reviewed intent.');
  assert(tx.signatures.length===2&&tx.signatures.every((signature,index)=>nacl.sign.detached.verify(message,signature,tx.message.staticAccountKeys[index].toBytes())),
    'Both exact conversion signatures required.');
  return {signature:bs58.encode(tx.signatures[0]),signedTransaction:base64};
}

// Expiry is not enough. The original context must still authenticate finalized
// absence AFTER expiry. Any unknown, stale or contradictory response stays charged.
export async function unusedTokenSellReservation({connection,release,row}){
  try{
    let signatureOutcome='unknown-signature-no-successful-conversion';
    const confirmed=await connection.isBlockhashValid(row.blockhash,{commitment:'confirmed'});
    if(confirmed.value!==false||!validSlot(confirmed.context?.slot,row.slot))return null;
    const finalized=await connection.isBlockhashValid(row.blockhash,{commitment:'finalized'});
    if(finalized.value!==false||!validSlot(finalized.context?.slot,confirmed.context.slot))return null;
    if(row.signature){
      const status=await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true}),outcome=status.value?.[0];
      if(!validSlot(status.context?.slot,finalized.context.slot)
        ||outcome&&!(outcome.confirmationStatus==='finalized'&&outcome.err!==null))return null;
      signatureOutcome=outcome?'failed-finalized':'not-observed-after-finalized-expiry';
    }
    const context=await finalizedProgramContext({connection,release,transactionSlot:row.slot,minimumContextSlot:finalized.context.slot});
    const receipt=await connection.getAccountInfoAndContext(new PublicKey(row.receipt),{commitment:'finalized',minContextSlot:context.programDataContextSlot});
    if(!validSlot(receipt.context?.slot,context.programDataContextSlot)||receipt.value!==null)return null;
    return {kind:'finalized-expired-and-absent',expirySlot:finalized.context.slot,receiptSlot:receipt.context.slot,
      programDataContextSlot:context.programDataContextSlot,programDataSha256:release.programDataSha256,signatureOutcome,
      feeOutcome:'Not established by receipt absence; failed or unknown transactions may have paid fees.'};
  }catch{return null;}
}
