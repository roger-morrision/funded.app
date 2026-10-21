import bs58 from 'bs58';
import { ComputeBudgetProgram, PublicKey, TransactionMessage,
  VersionedTransaction } from '@solana/web3.js';

export function prepareV3BuybackTransaction({ instruction, authority,
  blockhash, lookupTable, setupInstructions=[] }) {
  const message=new TransactionMessage({ payerKey:new PublicKey(authority),
    recentBlockhash:blockhash, instructions:[
      ComputeBudgetProgram.setComputeUnitLimit({ units:350_000 }), ...setupInstructions, instruction,
    ] })
    .compileToV0Message([lookupTable]);
  const transaction=new VersionedTransaction(message);
  if (transaction.serialize().length > 1232)
    throw new Error('The protected V3 buyback transaction exceeds Solana size limits.');
  return Buffer.from(transaction.serialize()).toString('base64');
}

export async function submitV3BuybackTransaction({ connection, transaction,
  authority, timeoutMs=90_000, pollMs=1000 }) {
  if (!(await connection.isBlockhashValid(transaction.message.recentBlockhash,
    'confirmed')).value)
    throw new Error('The protected V3 quote expired; prepare a fresh buyback.');
  transaction.sign([authority]);
  const signature=bs58.encode(transaction.signatures[0]);
  try {
    const submitted=await connection.sendRawTransaction(transaction.serialize(),{
      skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2 });
    if (submitted!==signature) throw new Error('RPC changed the V3 buyback signature.');
  } catch(error) {
    if (!/429|too many requests|timed? out|fetch failed|network/i.test(String(error?.message||error)))
      throw error;
  }
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    let row;
    try { row=(await connection.getSignatureStatuses([signature],{
      searchTransactionHistory:true })).value?.[0]; }
    catch(error) {
      if (!/429|too many requests|timed? out|fetch failed|network/i.test(String(error?.message||error)))
        throw error;
      await new Promise(resolve=>setTimeout(resolve,pollMs));continue;
    }
    if(row?.err) throw new Error('The protected V3 buyback failed on-chain.');
    if(row?.confirmationStatus==='finalized') return signature;
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  throw new Error(`V3 buyback ${signature} has no finalized receipt; reconcile before retrying.`);
}
