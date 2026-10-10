import bs58 from 'bs58';
import { SystemProgram, Transaction } from '@solana/web3.js';

export function solToLamports(amountSol) {
  const scaled = Number(amountSol) * 1_000_000_000;
  const lamports = Math.round(scaled);
  if (!Number.isSafeInteger(lamports) || lamports <= 0 || Math.abs(scaled - lamports) > 0.000001) {
    throw new Error('Payout amount must be a positive SOL value with at most nine decimal places.');
  }
  return lamports;
}

function uncertain(message, signature, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.pendingSignature = signature;
  return error;
}

function finalizedProof({ receipt, signature, payer, recipient, lamports }) {
  const keys = receipt?.transaction?.message?.accountKeys || [];
  const payerKey = keys[0]?.toBase58?.() || String(keys[0] || '');
  const index = keys.findIndex(key => (key?.toBase58?.() || String(key)) === recipient.toBase58());
  const before = receipt?.meta?.preBalances?.[index], after = receipt?.meta?.postBalances?.[index];
  if (receipt?.meta?.err || payerKey !== payer.publicKey.toBase58() || index < 0
    || !Number.isSafeInteger(before) || !Number.isSafeInteger(after) || after - before !== lamports) {
    throw uncertain('Finalized referral transfer has no exact payer and recipient proof.', signature);
  }
  return { signature, from: payer.publicKey.toBase58(), to: recipient.toBase58(), amountLamports: lamports,
    recipientDeltaLamports: after - before, finalized: true };
}

export async function reconcileFinalizedSolPayout({ connection, payer, recipient, lamports, signature }) {
  const receipt = await connection.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!receipt) throw uncertain('Referral transfer has no finalized receipt yet.', signature);
  return finalizedProof({ receipt, signature, payer, recipient, lamports });
}

// The signed signature is journaled before broadcast. Never sign or send a replacement on an
// ambiguous RPC result: a direct SOL transfer has no on-chain idempotency key.
export async function sendFinalizedSolPayout({ connection, payer, recipient, lamports, onSigned = async () => {},
  maxPolls = 75, pollDelayMs = 1000 }) {
  // A new SOL account must receive enough lamports to remain rent exempt.
  if (!await connection.getAccountInfo(recipient, 'confirmed')) {
    const minimum = await connection.getMinimumBalanceForRentExemption(0, 'confirmed');
    if (lamports < minimum) {
      const error = new Error('This referral reward is below the minimum needed to create a new SOL wallet. Fund the recipient wallet first, then retry.');
      error.safeToRetry = true; // No transaction was signed or broadcast.
      throw error;
    }
  }
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash })
    .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports }));
  transaction.sign(payer);
  const signature = bs58.encode(transaction.signature);
  await onSigned({ signature, from: payer.publicKey.toBase58(), to: recipient.toBase58(), lamports });
  let sendError;
  try {
    await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 2 });
  } catch (error) {
    sendError = error;
  }
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    try {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }))?.value?.[0];
      if (status?.err) throw uncertain('Referral transfer failed on chain; reconcile the signed signature.', signature);
      if (status?.confirmationStatus === 'finalized') {
        const receipt = await connection.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
        if (receipt) return finalizedProof({ receipt, signature, payer, recipient, lamports });
      }
      if (status?.confirmationStatus !== 'finalized' && latest.lastValidBlockHeight
        && await connection.getBlockHeight('confirmed') > latest.lastValidBlockHeight) break;
    } catch (error) {
      if (error?.pendingSignature) throw error;
      // Keep polling the signed signature if a status RPC request is temporarily unavailable.
    }
    if (attempt < maxPolls - 1) await new Promise(resolve => setTimeout(resolve, pollDelayMs));
  }
  throw uncertain('Referral transfer finality is unavailable; reconcile the signed signature before any retry.',
    signature, sendError);
}
