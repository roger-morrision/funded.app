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

export async function verifyFinalizedSettlementDelta({ connection, signature, router, recipient, amountLamports }) {
  const row = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  if (!row || row.meta?.err || !row.transaction?.signatures?.includes(signature)) {
    throw new Error('Finalized settlement transaction evidence is unavailable or failed.');
  }
  const keys = row.transaction.message.accountKeys;
  if (!Array.isArray(keys) || !Array.isArray(row.meta?.preBalances) || !Array.isArray(row.meta?.postBalances)) {
    throw new Error('Finalized settlement balance evidence is incomplete.');
  }
  const address = key => typeof key === 'string' ? key : key?.toBase58?.();
  const routerIndex = keys.findIndex(key => address(key) === new PublicKey(router).toBase58());
  const recipientIndex = keys.findIndex(key => address(key) === new PublicKey(recipient).toBase58());
  if (routerIndex < 0 || recipientIndex < 0 || routerIndex === recipientIndex) throw new Error('Settlement accounts are missing from finalized evidence.');
  const balances = [row.meta.preBalances[routerIndex], row.meta.postBalances[routerIndex],
    row.meta.preBalances[recipientIndex], row.meta.postBalances[recipientIndex]];
  if (!balances.every(Number.isSafeInteger)) throw new Error('Finalized settlement balances exceed exact JavaScript integer range.');
  const amount = BigInt(amountLamports);
  if (BigInt(row.meta.preBalances[routerIndex]) - BigInt(row.meta.postBalances[routerIndex]) !== amount
    || BigInt(row.meta.postBalances[recipientIndex]) - BigInt(row.meta.preBalances[recipientIndex]) !== amount) {
    throw new Error('Finalized settlement lacks the exact router debit and recipient credit.');
  }
  return true;
}
