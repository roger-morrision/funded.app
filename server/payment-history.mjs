import { createReadCache } from './read-cache.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const KINDS = new Set(['creator', 'holder', 'operations', 'x', 'community']);

function addressOf(key) {
  if (typeof key === 'string') return key;
  if (key?.pubkey) return addressOf(key.pubkey);
  return key?.toBase58?.() || '';
}

export function verifyAutomaticPayment(schedule, recipient, payment, transaction) {
  if (!KINDS.has(schedule?.kind) || schedule.asset !== 'SOL' || !ADDRESS.test(recipient)
    || payment?.status !== 'paid' || payment.finalized !== true || payment.balanceDeltaVerified !== true
    || !SIGNATURE.test(String(payment.signature || '')) || !/^[1-9]\d*$/.test(String(payment.amount || ''))
    || !transaction || transaction.meta?.err !== null || !transaction.transaction?.signatures?.includes(payment.signature)) return null;
  const amount = Number(payment.amount);
  const keys = [
    ...(transaction.transaction.message?.accountKeys || transaction.transaction.message?.staticAccountKeys || []),
    ...(transaction.meta.loadedAddresses?.writable || []),
    ...(transaction.meta.loadedAddresses?.readonly || []),
  ].map(addressOf);
  const index = keys.indexOf(recipient);
  const pre = transaction.meta.preBalances, post = transaction.meta.postBalances;
  const fee = transaction.meta.fee;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(transaction.slot) || transaction.slot <= 0
    || !Array.isArray(pre) || !Array.isArray(post) || pre.length !== post.length || pre.length !== keys.length
    || index < 0 || !Number.isSafeInteger(pre[index]) || !Number.isSafeInteger(post[index])
    || post[index] - pre[index] !== (keys[0] === recipient ? amount - fee : amount)
    || post[index] - pre[index] <= 0 || !Number.isSafeInteger(fee) || fee < 0 || !ADDRESS.test(keys[0])) return null;
  return { signature:payment.signature, source:`automatic-${schedule.kind}`, to:recipient,
    amountLamports:amount, actualReceivedLamports:post[index] - pre[index], feeLamports:fee, feePayer:keys[0],
    slot:transaction.slot, blockTime:transaction.blockTime ?? null };
}

export function createPaymentHistoryReader({ readEvidence, rewardsStore, connectionFactory, officialGenesis, cluster }) {
  const cache = createReadCache({ ttlMs:30_000, maxEntries:1 });
  return () => cache('recent', async () => {
    const [evidence, ledger] = await Promise.all([readEvidence(), rewardsStore.read()]);
    const verified = evidence.cluster === cluster && evidence.commitment === 'finalized'
      ? evidence.verifiedPayouts || [] : [];
    const candidates = Object.values(ledger.schedules || {}).flatMap(schedule => {
      if (!KINDS.has(schedule.kind) || schedule.asset !== 'SOL') return [];
      return Object.entries(schedule.payments || {}).map(([recipient, payment]) => ({ schedule, recipient, payment }));
    }).filter(({ schedule, recipient, payment }) => KINDS.has(schedule.kind) && ADDRESS.test(recipient)
      && payment?.status === 'paid' && payment.finalized === true && payment.balanceDeltaVerified === true
      && SIGNATURE.test(String(payment.signature || '')))
      .sort((a, b) => String(b.payment.paidAt || '').localeCompare(String(a.payment.paidAt || '')))
      .slice(0, 24);
    const automatic = [];
    let unavailable = 0;
    if (candidates.length) {
      try {
        const connection = connectionFactory();
        if (await connection.getGenesisHash() !== await officialGenesis()) throw new Error('Wrong Solana network');
        for (let i = 0; i < candidates.length; i += 4) {
          await Promise.all(candidates.slice(i, i + 4).map(async ({ schedule, recipient, payment }) => {
            try {
              const tx = await connection.getTransaction(payment.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
              const proof = verifyAutomaticPayment(schedule, recipient, payment, tx);
              if (proof) automatic.push(proof); else unavailable += 1;
            } catch { unavailable += 1; }
          }));
        }
      } catch { unavailable += candidates.length; }
    }
    const rows = [...new Map([...verified, ...automatic].filter(row =>
      ADDRESS.test(String(row.to || '')) && SIGNATURE.test(String(row.signature || ''))
      && Number.isSafeInteger(row.actualReceivedLamports) && row.actualReceivedLamports > 0
      && (row.feeLamports === null || Number.isSafeInteger(row.feeLamports) && row.feeLamports >= 0)
      && ADDRESS.test(String(row.feePayer || '')))
      .map(row => [`${row.signature}:${row.to}`, row])).values()]
      .sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0) || b.slot - a.slot).slice(0, 30);
    return { cluster, commitment:'finalized', status:unavailable || evidence.status === 'partial' || evidence.status === 'unavailable' ? 'partial' : 'onchain-indexed',
      verifiedPayouts:rows, checkedAutomatic:candidates.length, unavailableAutomatic:unavailable,
      note:'Network transaction fees are paid by the transaction fee payer; received amounts are verified recipient balance increases.' };
  });
}
