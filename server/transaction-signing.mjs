import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { createHash } from 'node:crypto';

// One signing path for local keypairs and remote signer handles.
// - Versioned transactions: like tx.sign(signers).
// - Legacy transactions: mode 'reset' is tx.sign(...signers) (prior signatures
//   cleared), mode 'partial' is tx.partialSign(...signers).
const isRemote = signer => typeof signer?.remoteSign === 'function';

export async function signTransaction(transaction, signers, { mode = 'reset' } = {}) {
  const list = (Array.isArray(signers) ? signers : [signers]).filter(Boolean);
  if (!list.length) throw new Error('A transaction signer is required.');
  if (transaction instanceof VersionedTransaction) {
    const local = list.filter(signer => !isRemote(signer));
    if (local.length) transaction.sign(local);
    const message = transaction.message.serialize();
    for (const signer of list.filter(isRemote)) transaction.addSignature(signer.publicKey, await signer.remoteSign(message, 'v0'));
    return transaction;
  }
  if (!(transaction instanceof Transaction)) throw new Error('Unsupported transaction type.');
  if (!list.some(isRemote)) { mode === 'partial' ? transaction.partialSign(...list) : transaction.sign(...list); return transaction; }
  if (mode !== 'partial') transaction.signatures = [];
  const message = transaction.serializeMessage();
  for (const signer of list) {
    if (isRemote(signer)) transaction.addSignature(signer.publicKey, Buffer.from(await signer.remoteSign(message, 'legacy')));
    else transaction.partialSign(signer);
  }
  return transaction;
}

// Drop-in replacement for web3.js sendAndConfirmTransaction that also accepts
// remote signer handles.
export async function sendAndConfirmSigned(connection, transaction, signers, options = {}) {
  if (!transaction.recentBlockhash) {
    const latest = await connection.getLatestBlockhash(options.preflightCommitment || options.commitment || 'confirmed');
    transaction.recentBlockhash = latest.blockhash; transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
  }
  if (!transaction.feePayer) transaction.feePayer = signers[0].publicKey;
  await signTransaction(transaction, signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: options.skipPreflight, preflightCommitment: options.preflightCommitment || options.commitment, maxRetries: options.maxRetries });
  const strategy = Number.isSafeInteger(transaction.lastValidBlockHeight)
    ? { signature, blockhash: transaction.recentBlockhash, lastValidBlockHeight: transaction.lastValidBlockHeight } : signature;
  const status = (await connection.confirmTransaction(strategy, options.commitment || 'confirmed')).value;
  if (status?.err) throw new Error(`Transaction ${signature} failed (${JSON.stringify(status.err)})`);
  return signature;
}

export const messageDigest = message => createHash('sha256').update(message).digest('hex');
