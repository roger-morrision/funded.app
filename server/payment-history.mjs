import { createReadCache } from './read-cache.mjs';
import { verifyPayoutReceipt } from './receipt-evidence.mjs';
import { cachedReceiptProof, receiptFingerprint } from './receipt-history.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const X_HANDLE = /^@?[A-Za-z0-9_]{1,15}$/;
const KINDS = new Set(['creator', 'holder', 'operations', 'x', 'community']);

function verifiedXHandle(state, cluster, mint, obligationId, wallet) {
  const launch = state.launches?.[mint];
  const obligation = state.obligations?.[obligationId];
  const handle = launch?.feeDistribution?.creatorDirected?.recipients?.xAccount;
  if (launch?.onchainVerified !== true || launch.cluster !== cluster || obligation?.mint !== mint
    || !obligation.xUserId || String(launch.xUserId) !== String(obligation.xUserId)
    || !X_HANDLE.test(String(handle || ''))) return null;
  const claim = Object.values(state.claims || {}).find(item => item.obligationId === obligationId
    && item.publicKey === wallet && String(item.xUserId) === String(obligation.xUserId)
    && String(item.xAttestation?.subject) === String(obligation.xUserId));
  return claim ? `@${String(handle).replace(/^@/, '')}` : null;
}

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

export function createPaymentHistoryReader({ readEvidence, rewardsStore, store, connectionFactory, officialGenesis, cluster }) {
  const cache = createReadCache({ ttlMs:30_000, maxEntries:1 });
  const verifiedAutomatic = new Map();
  return () => cache('recent', async () => {
    const [evidence, ledger, state] = await Promise.all([readEvidence(), rewardsStore.read(), store?.read?.() ?? {}]);
    const verified = evidence.cluster === cluster && evidence.commitment === 'finalized'
      ? evidence.verifiedPayouts || [] : [];
    const recorded = Object.values(state.payouts || {}).filter(row => row?.cluster === cluster && row.status === 'paid'
      && ['solana-keeper-referral-claim', 'mint-router-settle-mint'].includes(row.source));
    const recentKeys = new Set(verified.map(row => `${row.signature}:${row.to}`));
    const older = recorded.filter(row => !recentKeys.has(`${row.signature}:${row.to}`));
    const candidates = Object.values(ledger.schedules || {}).flatMap(schedule => {
      if (!KINDS.has(schedule.kind) || schedule.asset !== 'SOL') return [];
      return Object.entries(schedule.payments || {}).map(([recipient, payment]) => ({ schedule, recipient, payment }));
    }).filter(({ schedule, recipient, payment }) => KINDS.has(schedule.kind) && ADDRESS.test(recipient)
      && payment?.status === 'paid' && payment.finalized === true && payment.balanceDeltaVerified === true
      && SIGNATURE.test(String(payment.signature || '')))
      .sort((a, b) => String(b.payment.paidAt || '').localeCompare(String(a.payment.paidAt || '')));
    const automatic = [];
    const olderProofs = [];
    let unavailable = 0;
    if (candidates.length || older.length) {
      try {
        const connection = connectionFactory();
        if (await connection.getGenesisHash() !== await officialGenesis()) throw new Error('Wrong Solana network');
        let indexed = new Map();
        try {
          indexed = new Map((await store?.readReceiptProofs?.(older.map(row => receiptFingerprint('payouts', row))) || [])
            .map(entry => [entry.key, entry]));
        } catch { /* RPC verification below remains available. */ }
        const additions = [];
        for (let i = 0; i < older.length; i += 4) {
          await Promise.all(older.slice(i, i + 4).map(async row => {
            const key = receiptFingerprint('payouts', row);
            let proof = cachedReceiptProof(indexed.get(key), 'payouts', row);
            if (!proof) {
              try {
                const tx = await connection.getTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
                proof = verifyPayoutReceipt(row, tx);
                if (proof) additions.push({ key, cluster, commitment:'finalized', proof, verifiedAt:new Date().toISOString() });
              } catch { /* Count unavailable below. */ }
            }
            if (proof) olderProofs.push(proof);
            else unavailable += 1;
          }));
        }
        if (additions.length) {
          try { await store?.writeReceiptProofs?.(additions); }
          catch { /* Verified rows can still be shown for this request. */ }
        }
        for (let i = 0; i < candidates.length; i += 4) {
          await Promise.all(candidates.slice(i, i + 4).map(async ({ schedule, recipient, payment }) => {
            try {
              const key = `${schedule.kind}:${payment.signature}:${recipient}:${payment.amount}`;
              let proof = verifiedAutomatic.get(key);
              if (!proof) {
                const tx = await connection.getTransaction(payment.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
                proof = verifyAutomaticPayment(schedule, recipient, payment, tx);
                if (proof) verifiedAutomatic.set(key, proof);
              }
              if (proof) {
                const request = schedule.kind === 'x' ? ledger.fundingRequests?.[schedule.sourceId] : null;
                const xHandle = request?.kind === 'x' && request.mint === schedule.mint
                  && request.recipient === recipient
                  ? verifiedXHandle(state, cluster, schedule.mint, request.obligationId, recipient) : null;
                automatic.push(xHandle ? { ...proof, xHandle } : proof);
              } else unavailable += 1;
            } catch { unavailable += 1; }
          }));
        }
      } catch { unavailable += candidates.length + older.length; }
    }
    const recordedX = new Map(Object.values(state.payouts || {})
      .filter(row => row?.source === 'mint-router-settle-mint' && row.status === 'paid' && row.cluster === cluster)
      .map(row => [`${row.signature}:${row.to}`, row]));
    const attributed = [...verified, ...olderProofs].map(proof => {
      if (proof.source !== 'mint-router-settle-mint') return proof;
      const record = recordedX.get(`${proof.signature}:${proof.to}`);
      const xHandle = record && Number(record.amountLamports) === proof.amountLamports
        ? verifiedXHandle(state, cluster, record.mint, record.obligationId, proof.to) : null;
      return xHandle ? { ...proof, xHandle } : proof;
    });
    const rows = [...new Map([...attributed, ...automatic].filter(row =>
      ADDRESS.test(String(row.to || '')) && SIGNATURE.test(String(row.signature || ''))
      && Number.isSafeInteger(row.actualReceivedLamports) && row.actualReceivedLamports > 0
      && (row.feeLamports === null || Number.isSafeInteger(row.feeLamports) && row.feeLamports >= 0)
      && ADDRESS.test(String(row.feePayer || '')))
      .map(row => [`${row.signature}:${row.to}`, row])).values()]
      .sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0) || b.slot - a.slot);
    return { cluster, commitment:'finalized', status:unavailable || evidence.status === 'unavailable' ? 'partial' : 'onchain-indexed',
      verifiedPayouts:rows, checkedAutomatic:candidates.length, unavailablePayouts:unavailable,
      note:'Network transaction fees are paid by the transaction fee payer; received amounts are verified recipient balance increases.' };
  });
}
