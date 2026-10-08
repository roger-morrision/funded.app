import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey, Transaction } from '@solana/web3.js';

export function prepareCreatorSettlement({ instruction, authority, blockhash }) {
  if (!blockhash) throw new Error('A recent Devnet blockhash is required.');
  const transaction = new Transaction({ feePayer:new PublicKey(authority), recentBlockhash:blockhash }).add(instruction);
  return transaction.serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64');
}

export function verifyCreatorSettlement({ signedTransaction, instruction, authority, creator }) {
  if (typeof signedTransaction !== 'string' || signedTransaction.length > 2400
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransaction)) throw new Error('Invalid creator-signed transaction encoding.');
  let transaction;
  try { transaction = Transaction.from(Buffer.from(signedTransaction, 'base64')); }
  catch { throw new Error('Creator-signed transaction cannot be decoded.'); }
  if (!transaction.recentBlockhash) throw new Error('Creator-signed transaction has no blockhash.');
  const expected = new Transaction({ feePayer:new PublicKey(authority), recentBlockhash:transaction.recentBlockhash }).add(instruction);
  const message = expected.serializeMessage();
  if (!transaction.serializeMessage().equals(message)) throw new Error('Creator-signed transaction changes the approved payout.');
  const creatorKey = new PublicKey(creator);
  const creatorSignature = transaction.signatures.find(entry => entry.publicKey.equals(creatorKey))?.signature;
  if (!creatorSignature || !nacl.sign.detached.verify(message, creatorSignature, creatorKey.toBytes())) {
    throw new Error('The launch creator has not signed the exact payout transaction.');
  }
  const authoritySignature = transaction.signatures.find(entry => entry.publicKey.equals(new PublicKey(authority)))?.signature;
  if (authoritySignature) throw new Error('The router authority signature must be added by the server.');
  return transaction;
}

export async function submitCreatorSettlement({ connection, transaction, authority, timeoutMs = 90_000, pollMs = 1000 }) {
  const valid = await connection.isBlockhashValid(transaction.recentBlockhash, 'confirmed');
  if (!valid.value) throw new Error('Creator approval expired. Prepare and sign a fresh transaction.');
  transaction.partialSign(authority);
  const signature = bs58.encode(transaction.signature);
  try {
    const submitted = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight:false, preflightCommitment:'confirmed', maxRetries:2 });
    if (submitted !== signature) throw new Error('RPC returned a different settlement transaction signature.');
  } catch (error) {
    if (!/429|too many requests|timed? out|fetch failed|network/i.test(String(error?.message || error))) throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let status;
    try { status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory:true })).value?.[0]; }
    catch (error) {
      if (!/429|too many requests|timed? out|fetch failed|network/i.test(String(error?.message || error))) throw error;
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    if (status?.err) throw new Error(`Creator-approved settlement failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'finalized') return signature;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`Creator-approved settlement ${signature} has no verified finalized receipt; reconcile before retrying.`);
}
