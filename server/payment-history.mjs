import { createReadCache } from './read-cache.mjs';
import { verifyPayoutReceipt } from './receipt-evidence.mjs';
import { cachedReceiptProof, receiptFingerprint } from './receipt-history.mjs';
import { loadFinalizedV3RewardFunding } from './v3-reward-funding-proof.mjs';
import { v3DisbursementId } from './v3-disbursement-id.mjs';

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

export function createPaymentHistoryReader({ readEvidence, rewardsStore, store, connectionFactory, officialGenesis,
  cluster, v3Only = false, loadCreatorPayment = loadFinalizedV3RewardFunding }) {
  const cache = createReadCache({ ttlMs:30_000, maxEntries:1 });
  const verifiedAutomatic = new Map();
  return () => cache('recent', async () => {
    const [evidence, ledger, state] = await Promise.all([readEvidence(), rewardsStore.read(), store?.read?.() ?? {}]);
    const verified = !v3Only && evidence.cluster === cluster && evidence.commitment === 'finalized'
      ? evidence.verifiedPayouts || [] : [];
    const recorded = (v3Only ? [] : Object.values(state.payouts || {})).filter(row => row?.cluster === cluster && row.status === 'paid'
      && ['solana-keeper-referral-claim', 'mint-router-settle-mint'].includes(row.source));
    const recentKeys = new Set(verified.map(row => `${row.signature}:${row.to}`));
    const older = recorded.filter(row => !recentKeys.has(`${row.signature}:${row.to}`));
    const candidates = Object.values(ledger.schedules || {}).flatMap(schedule => {
      if (!KINDS.has(schedule.kind) || schedule.asset !== 'SOL') return [];
      return Object.entries(schedule.payments || {}).map(([recipient, payment]) => ({ schedule, recipient, payment }));
    }).filter(({ schedule, recipient, payment }) => (!v3Only || schedule.kind === 'holder'
      && (schedule.poolIds || []).some(id => id.startsWith('v3:')
        && state.v3CreatorRewardFunding?.[id.slice(3)]?.status === 'finalized'
        && state.v3CreatorRewardFunding[id.slice(3)].balanceDeltaVerified === true
        && ledger.rewardPools?.[id]?.fundingSignature === state.v3CreatorRewardFunding[id.slice(3)].signature)
      || v3Only && schedule.kind === 'x'
        && state.v3XClaims?.[schedule.sourceId]?.status === 'paid'
        && state.v3XClaims[schedule.sourceId].wallet === recipient
        && state.v3XClaims[schedule.sourceId].payment?.signature === payment.signature
        && state.v3XClaims[schedule.sourceId].payment?.finalized === true
        && state.v3XClaims[schedule.sourceId].payment?.balanceDeltaVerified === true)
      && KINDS.has(schedule.kind) && ADDRESS.test(recipient)
      && payment?.status === 'paid' && payment.finalized === true && payment.balanceDeltaVerified === true
      && SIGNATURE.test(String(payment.signature || '')))
      .sort((a, b) => String(b.payment.paidAt || '').localeCompare(String(a.payment.paidAt || '')));
    const creatorCandidates = v3Only ? Object.entries(state.v3CreatorWalletPayout || {})
      .filter(([, row]) => row?.status === 'finalized') : [];
    const automatic = [];
    const creators = [];
    const olderProofs = [];
    let unavailable = 0;
    if (candidates.length || older.length || creatorCandidates.length) {
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
                const v3Claim = v3Only ? state.v3XClaims?.[schedule.sourceId] : null;
                const v3Launch = v3Claim && state.launches?.[schedule.mint];
                const xHandle = v3Only ? v3Launch?.pumpFeeRoute?.scope === 'per-mint-v3'
                  && String(v3Launch.xUserId) === String(v3Claim.xUserId)
                  ? v3Launch.feeDistribution?.creatorDirected?.recipients?.xAccount : null
                  : request?.kind === 'x' && request.mint === schedule.mint
                    && request.recipient === recipient
                    ? verifiedXHandle(state, cluster, schedule.mint, request.obligationId, recipient) : null;
                automatic.push(xHandle ? { ...proof, xHandle } : proof);
              } else unavailable += 1;
            } catch { unavailable += 1; }
          }));
        }
        for (let i = 0; i < creatorCandidates.length; i += 4) {
          await Promise.all(creatorCandidates.slice(i, i + 4).map(async ([source, row]) => {
            try {
              const launch = state.launches?.[row.mint];
              const collection = state.collections?.[source];
              const settlement = state.v3Settlements?.[source];
              const route = launch?.pumpFeeRoute;
              const amount = Number(row.amount);
              if (cluster !== 'devnet' || !SIGNATURE.test(String(row.signature || ''))
                || !SIGNATURE.test(String(settlement?.settlementSignature || ''))
                || !ADDRESS.test(String(row.mint || '')) || !ADDRESS.test(String(row.recipient || ''))
                || !Number.isSafeInteger(amount) || amount <= 0
                || row.balanceDeltaVerified !== true || row.category !== 0
                || row.collectionSignature !== source || row.recipient !== launch?.creatorWallet
                || launch?.onchainVerified !== true || launch.cluster !== cluster
                || route?.scope !== 'per-mint-v3' || !ADDRESS.test(String(route.programId || ''))
                || row.programId !== route.programId || !ADDRESS.test(String(route.initialAuthority || ''))
                || collection?.signature !== source || collection.mint !== row.mint
                || collection.cluster !== cluster || collection.scope !== 'per-mint-v3'
                || collection.programId !== route.programId || collection.status !== 'collected'
                || collection.onchainVerified !== true || settlement?.status !== 'finalized'
                || settlement.collectionSignature !== source || settlement.mint !== row.mint
                || settlement.allocationPlan?.status !== 'allocated-not-funded'
                || String(settlement.allocationPlan.creatorDirected?.walletLamports) !== String(row.amount))
                throw new Error('Creator payment lacks a matching V3 allocation');
              const transaction = await connection.getTransaction(row.signature, {
                commitment:'finalized', maxSupportedTransactionVersion:0 });
              const authority = addressOf(transaction?.transaction?.message?.accountKeys?.[0]
                || transaction?.transaction?.message?.staticAccountKeys?.[0]);
              if (!ADDRESS.test(authority)) throw new Error('Missing transaction authority');
              const proof = await loadCreatorPayment({ connection, transaction, signature:row.signature,
                programId:route.programId, mint:row.mint, authority, creator:launch.creatorWallet,
                initialAuthority:route.initialAuthority,
                withdrawalId:v3DisbursementId('creator-wallet', settlement.settlementSignature),
                category:0, amount:row.amount, recipient:row.recipient, split:route.protocolSplit });
              if (!proof || proof.signature !== row.signature || proof.recipient !== row.recipient
                || proof.mint !== row.mint || proof.programId !== route.programId
                || proof.category !== 0 || proof.amount !== String(row.amount)
                || proof.balanceDeltaVerified !== true || !Number.isSafeInteger(proof.slot)
                || proof.slot <= 0 || proof.feePayer !== authority
                || !Number.isSafeInteger(proof.feeLamports) || proof.feeLamports < 0)
                throw new Error('Creator payment proof does not match');
              creators.push({ signature:row.signature, source:'v3-creator-wallet', to:row.recipient,
                mint:row.mint, amountLamports:amount, actualReceivedLamports:amount,
                feeLamports:proof.feeLamports, feePayer:authority,
                slot:proof.slot, blockTime:proof.blockTime ?? null });
            } catch { unavailable += 1; }
          }));
        }
      } catch { unavailable += candidates.length + older.length + creatorCandidates.length; }
    }
    const recordedX = new Map((v3Only ? [] : Object.values(state.payouts || {}))
      .filter(row => row?.source === 'mint-router-settle-mint' && row.status === 'paid' && row.cluster === cluster)
      .map(row => [`${row.signature}:${row.to}`, row]));
    const attributed = [...verified, ...olderProofs].map(proof => {
      if (proof.source !== 'mint-router-settle-mint') return proof;
      const record = recordedX.get(`${proof.signature}:${proof.to}`);
      const xHandle = record && Number(record.amountLamports) === proof.amountLamports
        ? verifiedXHandle(state, cluster, record.mint, record.obligationId, proof.to) : null;
      return xHandle ? { ...proof, xHandle } : proof;
    });
    const rows = [...new Map([...attributed, ...automatic, ...creators].filter(row =>
      ADDRESS.test(String(row.to || '')) && SIGNATURE.test(String(row.signature || ''))
      && Number.isSafeInteger(row.actualReceivedLamports) && row.actualReceivedLamports > 0
      && (row.feeLamports === null || Number.isSafeInteger(row.feeLamports) && row.feeLamports >= 0)
      && ADDRESS.test(String(row.feePayer || '')))
      .map(row => [`${row.signature}:${row.to}`, row])).values()]
      .sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0) || b.slot - a.slot);
    return { cluster, commitment:'finalized', status:unavailable || !v3Only && evidence.status === 'unavailable' ? 'partial' : 'onchain-indexed',
      verifiedPayouts:rows, checkedAutomatic:candidates.length, checkedCreator:creatorCandidates.length,
      unavailablePayouts:unavailable, generatedAt:new Date().toISOString(),
      note:'Network transaction fees are paid by the transaction fee payer; received amounts are verified recipient balance increases.' };
  });
}
