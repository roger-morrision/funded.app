import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

export function prepareV3BuybackTransaction({ instruction, authority,
  blockhash, lookupTable }) {
  const message=new TransactionMessage({ payerKey:new PublicKey(authority),
    recentBlockhash:blockhash, instructions:[instruction] })
    .compileToV0Message([lookupTable]);
  const transaction=new VersionedTransaction(message);
  if (transaction.serialize().length > 1232)
    throw new Error('The protected V3 buyback transaction exceeds Solana size limits.');
  return Buffer.from(transaction.serialize()).toString('base64');
}

export function verifyV3BuybackTransaction({ signedTransaction,
  preparedTransaction, authority, creator }) {
  if (typeof signedTransaction !== 'string' || signedTransaction.length > 2500
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransaction))
    throw new Error('Invalid creator-signed V3 buyback transaction encoding.');
  let signed, prepared;
  try {
    signed=VersionedTransaction.deserialize(Buffer.from(signedTransaction,'base64'));
    prepared=VersionedTransaction.deserialize(Buffer.from(preparedTransaction,'base64'));
  } catch { throw new Error('The V3 buyback transaction cannot be decoded.'); }
  const message=Buffer.from(signed.message.serialize());
  if (!message.equals(Buffer.from(prepared.message.serialize())))
    throw new Error('The creator changed the protected V3 buyback transaction.');
  const keys=signed.message.staticAccountKeys;
  const creatorIndex=keys.findIndex(key=>key.equals(new PublicKey(creator)));
  const authorityIndex=keys.findIndex(key=>key.equals(new PublicKey(authority)));
  const required=signed.message.header.numRequiredSignatures;
  if (creatorIndex<0 || creatorIndex>=required || authorityIndex<0
    || authorityIndex>=required || creatorIndex===authorityIndex
    || !nacl.sign.detached.verify(message,signed.signatures[creatorIndex],
      new PublicKey(creator).toBytes())
    || signed.signatures[authorityIndex].some(byte=>byte!==0))
    throw new Error('The launch creator must sign exactly this V3 buyback transaction.');
  return signed;
}

export async function submitV3BuybackTransaction({ connection, transaction,
  authority, timeoutMs=90_000, pollMs=1000 }) {
  if (!(await connection.isBlockhashValid(transaction.message.recentBlockhash,
    'confirmed')).value)
    throw new Error('The creator approval expired; prepare a fresh V3 buyback.');
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
    if(row?.err) throw new Error('The creator-approved V3 buyback failed on-chain.');
    if(row?.confirmationStatus==='finalized') return signature;
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  throw new Error(`V3 buyback ${signature} has no finalized receipt; reconcile before retrying.`);
}
