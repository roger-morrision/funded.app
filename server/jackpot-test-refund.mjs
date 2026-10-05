import bs58 from 'bs58';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

// This is only for in-memory Solana test keys. Keep the process alive on a
// transient refund failure so the keys are not discarded before reconciliation.
export async function refundEphemeralDevnetBalances({ connection, signers, refundAddress,
  waitForRetry, onReceipt = () => {}, send = null }) {
  const refund = new PublicKey(refundAddress);
  const transfer = send || (async (signer, amountLamports, latest) => {
    const transaction = new Transaction({ recentBlockhash:latest.blockhash,
      feePayer:signer.publicKey }).add(SystemProgram.transfer({
      fromPubkey:signer.publicKey, toPubkey:refund, lamports:amountLamports,
    }));
    transaction.sign(signer);
    const signature = bs58.encode(transaction.signature);
    try { await connection.sendRawTransaction(transaction.serialize()); }
    catch { /* The signature remains known; reconcile before any retry. */ }
    return { signature, lastValidBlockHeight:latest.lastValidBlockHeight };
  });
  for (const signer of signers) {
    const source = signer.publicKey.toBase58();
    let pending = null;
    for (;;) {
      try {
        if (pending) {
          const tx = await connection.getParsedTransaction(pending.signature,
            { commitment:'finalized', maxSupportedTransactionVersion:0 });
          if (tx?.meta?.err) { pending = null; throw new Error('Refund transaction failed on chain.'); }
          if (tx && tx.transaction?.message?.instructions?.some(row =>
            row.program === 'system' && row.parsed?.type === 'transfer'
            && row.parsed.info.source === source
            && row.parsed.info.destination === refundAddress
            && row.parsed.info.lamports === pending.amountLamports)) {
            onReceipt({ source, destination:refundAddress, amountLamports:pending.amountLamports,
              signature:pending.signature, status:'finalized' });
            break;
          }
          if (tx) throw new Error('Finalized refund does not match the intended transfer.');
          const height = await connection.getBlockHeight('finalized');
          if (height > pending.lastValidBlockHeight) {
            pending = null;
            throw new Error('Refund transaction expired before finalization.');
          }
          throw new Error('Refund transaction is pending finalization.');
        }
        const balance = await connection.getBalance(signer.publicKey, 'finalized');
        if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Invalid finalized balance.');
        // Closing a temporary system wallet to zero avoids a rent-violating
        // dust balance. Quote the fee for the same blockhash used to send.
        const latest = await connection.getLatestBlockhash('finalized');
        const feeProbe = new Transaction({ recentBlockhash:latest.blockhash,
          feePayer:signer.publicKey }).add(SystemProgram.transfer({
          fromPubkey:signer.publicKey, toPubkey:refund, lamports:1,
        }));
        const fee = (await connection.getFeeForMessage(feeProbe.compileMessage(), 'finalized'))?.value;
        if (!Number.isSafeInteger(fee) || fee < 0) throw new Error('Finalized refund fee quote is unavailable.');
        if (balance <= fee) {
          onReceipt({ source, residualLamports:balance, status:'settled' });
          break;
        }
        const amountLamports = balance - fee;
        const submission = await transfer(signer, amountLamports, latest);
        if (!submission || !submission.signature
          || !Number.isSafeInteger(submission.lastValidBlockHeight))
          throw new Error('Refund signature and expiry are required for reconciliation.');
        pending = { ...submission, amountLamports };
      } catch (error) {
        if (typeof waitForRetry !== 'function') throw error;
        await waitForRetry({ source, error });
      }
    }
  }
}
