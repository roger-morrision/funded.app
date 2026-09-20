// Only a confirmed, successful transaction with the expected lamport delta is a receipt.
// A local ledger row or a submitted signature is never enough on its own.
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function addressOf(key) {
  if (typeof key === 'string') return key;
  if (key?.pubkey) return addressOf(key.pubkey);
  return key?.toBase58?.() || '';
}

function transactionBalances(transaction, signature) {
  if (!transaction || transaction.meta?.err !== null || !Number.isSafeInteger(transaction.slot) || transaction.slot <= 0) return null;
  if (!transaction.transaction?.signatures?.includes(signature)) return null;
  const keys = [
    ...(transaction.transaction?.message?.accountKeys || transaction.transaction?.message?.staticAccountKeys || []),
    ...(transaction.meta?.loadedAddresses?.writable || []),
    ...(transaction.meta?.loadedAddresses?.readonly || []),
  ].map(addressOf);
  const pre = transaction.meta?.preBalances;
  const post = transaction.meta?.postBalances;
  if (!Array.isArray(pre) || !Array.isArray(post) || pre.length !== post.length || pre.length !== keys.length) return null;
  const delta = address => {
    const index = keys.indexOf(address);
    if (index < 0 || !Number.isSafeInteger(pre[index]) || !Number.isSafeInteger(post[index])) return null;
    return post[index] - pre[index];
  };
  return { delta, slot: transaction.slot, blockTime: transaction.blockTime ?? null };
}

function validRecord(record) {
  return record?.cluster === 'devnet' && signaturePattern.test(String(record.signature || ''));
}

export function verifyCollectionReceipt(record, transaction) {
  if (!validRecord(record) || record.status !== 'collected' || record.attribution !== 'mint-verified'
    || record.onchainVerified !== true || !addressPattern.test(String(record.mint || ''))
    || !addressPattern.test(String(record.router || ''))
    || !Number.isSafeInteger(record.collectedLamports) || record.collectedLamports <= 0) return null;
  const balances = transactionBalances(transaction, record.signature);
  if (!balances || balances.delta(record.router) !== record.collectedLamports) return null;
  return { signature: record.signature, mint: record.mint, collectedLamports: record.collectedLamports,
    slot: balances.slot, blockTime: balances.blockTime };
}

export function verifyPayoutReceipt(record, transaction) {
  if (!validRecord(record) || record.status !== 'paid' || !['solana-keeper-referral-claim', 'mint-router-settle-mint'].includes(record.source)
    || !addressPattern.test(String(record.from || '')) || !addressPattern.test(String(record.to || ''))
    || record.from === record.to) return null;
  const amount = record.amountLamports == null ? Number(record.amountSol) * 1_000_000_000 : Number(record.amountLamports);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const balances = transactionBalances(transaction, record.signature);
  if (!balances || balances.delta(record.to) !== amount || balances.delta(record.from) > -amount) return null;
  return { signature: record.signature, claimId: record.claimId || null, source: record.source,
    to: record.to, amountLamports: amount, slot: balances.slot, blockTime: balances.blockTime };
}
