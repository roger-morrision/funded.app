import { PublicKey, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { launchServiceMemo } from '../launch-service-fee.js';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export function verifyLaunchServiceFee({ transaction:tx, signature, mint, payer, quote }) {
  if (!quote || quote.payer !== payer || !/^\d+$/.test(quote.amountLamports || '') || BigInt(quote.amountLamports) > 5_000_000_000n)
    throw new Error('Saved launch service quote is missing or does not match the payer.');
  const time = tx?.blockTime * 1000;
  if (!Number.isFinite(Date.parse(quote.createdAt)) || !Number.isFinite(Date.parse(quote.expiresAt))) throw new Error('Launch fee quote timing is invalid.');
  if (!tx?.meta || tx.meta.err !== null || !tx.transaction?.signatures?.includes(signature)
    || !Number.isSafeInteger(tx.slot) || tx.slot < 1 || !Number.isFinite(time)
    || time < Date.parse(quote.createdAt) - 30_000 || time > Date.parse(quote.expiresAt) + 30_000) throw new Error('Launch fee requires a successful finalized transaction within its quote window.');
  const message = tx.transaction.message;
  const keys = [...(message.staticAccountKeys || message.accountKeys || []), ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(k => new PublicKey(k.pubkey || k).toBase58());
  if (keys[0] !== payer || keys[0] === quote.recipient) throw new Error('Launch fee payer is invalid.');
  const decode = ix => typeof ix.data === 'string' ? Buffer.from(bs58.decode(ix.data)) : Buffer.from(ix.data || []);
  const instructions = message.compiledInstructions || message.instructions || [];
  const memos = instructions.filter(ix => keys[ix.programIdIndex] === MEMO && decode(ix).toString() === launchServiceMemo(mint,quote.id));
  const transfers = instructions.filter(ix => {
    const data = decode(ix), accounts = ix.accountKeyIndexes || ix.accounts || [];
    return keys[ix.programIdIndex] === SystemProgram.programId.toBase58() && data.length === 12 && data.readUInt32LE() === 2
      && accounts.length === 2 && keys[accounts[0]] === payer && keys[accounts[1]] === quote.recipient
      && data.readBigUInt64LE(4).toString() === quote.amountLamports;
  });
  const n = BigInt(quote.amountLamports), index = keys.indexOf(quote.recipient);
  if (memos.length !== 1 || transfers.length !== (n > 0n ? 1 : 0)
    || n > 0n && (index < 0 || !Number.isSafeInteger(tx.meta.preBalances[index]) || !Number.isSafeInteger(tx.meta.postBalances[index])
      || BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index]) !== n)) throw new Error('Exact atomic launch fee transfer, memo and treasury delta are not verified.');
  return { quoteId:quote.id, amountLamports:quote.amountLamports, recipient:quote.recipient, policyHash:quote.policyHash,
    signature, slot:tx.slot, finalized:true, balanceDeltaVerified:true, category:'launch-service-fee' };
}
