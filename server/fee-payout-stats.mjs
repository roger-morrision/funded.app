import { payoutReceiptLamports } from './receipt-evidence.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const HANDLE = /^@?[A-Za-z0-9_]{1,15}$/;
const KINDS = ['x', 'creator', 'holder'];

function amount(value) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) return null;
  const units = BigInt(value);
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? units : null;
}
function solLamports(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(String(value ?? ''))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
}

function empty(status) {
  return { paidLamports:status === 'unavailable' ? null : '0', payoutCount:status === 'unavailable' ? null : 0,
    top:null, status };
}

function communityHolderClaims(index, cluster, now = Date.now()) {
  const unavailable = { status:'unavailable', asset:'launched tokens', claimCount:null, top:null,
    reason:'Finalized community claims have not been indexed by recipient.' };
  if (index?.cluster !== cluster || index.commitment !== 'finalized' || index.status !== 'verified'
    || !Array.isArray(index.drops) || !Array.isArray(index.payments)) return unavailable;
  const indexedAt = Date.parse(index.indexedAt);
  if (!Number.isFinite(indexedAt) || indexedAt > now + 60_000 || now - indexedAt > 20 * 60_000)
    return { ...unavailable, reason:'Community claim index is stale; waiting for a finalized Devnet rescan.' };
  const opened = new Set(index.drops.map(row => row.mint));
  const seen = new Set(), groups = new Map();
  for (const payment of index.payments) {
    if (!opened.has(payment.mint) || !ADDRESS.test(String(payment.recipient || ''))
      || !ADDRESS.test(String(payment.payment || ''))
      || !/^[1-9]\d*$/.test(String(payment.amountBaseUnits || '')) || seen.has(payment.payment)) return unavailable;
    seen.add(payment.payment);
    const group = groups.get(payment.recipient) || { recipient:payment.recipient, claimCount:0, mints:new Set() };
    group.claimCount += 1;
    group.mints.add(payment.mint);
    groups.set(payment.recipient, group);
  }
  const leader = [...groups.values()].sort((a, b) => b.claimCount - a.claimCount || a.recipient.localeCompare(b.recipient))[0];
  return { status:'verified', asset:'launched tokens', claimCount:index.payments.length,
    dropCount:index.drops.length, indexedAt:index.indexedAt, reason:null,
    top:leader ? { recipient:leader.recipient, claimCount:leader.claimCount, launchCount:leader.mints.size } : null };
}

// Fee totals require a finalized collection, a funded reward request, and a
// finalized recipient payment. A paid flag or policy allocation alone is not a payout.
export function feePayoutStats(state = {}, rewards = null, evidence = {}, cluster = 'devnet') {
  const unavailable = { cluster, commitment:'finalized', x:empty('unavailable'), creator:empty('unavailable'),
    holder:empty('unavailable'), fundedHolder:communityHolderClaims(rewards?.communityClaimIndex, cluster) };
  if (!rewards?.schedules || evidence.cluster !== cluster || evidence.commitment !== 'finalized'
    || !['onchain-indexed', 'partial', 'no-records'].includes(evidence.status)) return unavailable;

  const collections = new Map((evidence.verifiedCollections || []).map(proof => [proof.signature, proof]));
  const payoutProofs = new Map((evidence.verifiedPayouts || []).map(proof => [`${proof.signature}:${proof.to}`, proof]));
  const rows = new Map(), incomplete = { x:false, creator:false, holder:false };
  const unlinkedPayments = { x:0, creator:0, holder:0 };
  const collectionVerified = (mint, signature) => {
    const record = state.collections?.[signature], proof = collections.get(signature);
    const launch = state.launches?.[mint], settlement = state.settlements?.[signature];
    const collected = amount(record?.collectedLamports);
    return launch?.onchainVerified === true && launch.cluster === cluster
      && collected !== null && record?.mint === mint && record.cluster === cluster && record.status === 'collected'
      && record.onchainVerified === true && record.attribution === 'mint-verified'
      && proof?.mint === mint && proof.collectedLamports === record.collectedLamports
      && settlement?.claimSignature === signature && settlement.asset === 'SOL'
      && solLamports(settlement.grossCreatorFees) === collected;
  };
  const settlementMatches = (kind, signature, units) => {
    const settlement = state.settlements?.[signature];
    const field = kind === 'creator' ? 'creatorWallet' : kind === 'holder' ? 'holderAirdrop' : 'solClaim';
    const settled = solLamports(settlement?.creatorDestinations?.[field]);
    return units !== null && settled !== null && settlement?.claimSignature === signature
      && settlement.asset === 'SOL' && settled === units;
  };
  const xIdentity = (mint, obligationId) => {
    const obligation = state.obligations?.[obligationId];
    const launch = state.launches?.[mint];
    if (obligation?.mint !== mint || !obligation.xUserId) return null;
    const handle = launch?.feeDistribution?.creatorDirected?.recipients?.xAccount;
    return { id:String(obligation.xUserId), handle:HANDLE.test(String(handle || '')) ? `@${String(handle).replace(/^@/, '')}` : null };
  };
  const add = (kind, wallet, signature, units, identity = null) => {
    const key = `${signature}:${wallet}`, prior = rows.get(key);
    if (prior) {
      if (prior.kind !== kind || prior.amount !== units || prior.identity?.id !== identity?.id) incomplete[kind] = true;
      return;
    }
    rows.set(key, { kind, wallet, signature, amount:units, identity });
  };

  for (const schedule of Object.values(rewards.schedules)) {
    if (!KINDS.includes(schedule?.kind) || schedule.asset !== 'SOL'
      || schedule.cluster && schedule.cluster !== cluster) continue;
    const kind = schedule.kind;
    const sourceIds = kind === 'holder' ? schedule.poolIds : [schedule.sourceId];
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some(id => !id)) {
      if (Object.values(schedule.payments || {}).some(payment => payment?.status === 'paid')) incomplete[kind] = true;
      continue;
    }
    const requests = sourceIds.map(id => rewards.fundingRequests?.[id]);
    const sourceReady = requests.every((request, index) => request?.mint === schedule.mint
      && request.asset === 'SOL' && request.kind === (kind === 'holder' ? 'holder' : kind)
      && request.status === 'funded' && request.balanceDeltaVerified === true
      && SIGNATURE.test(String(request.fundingSignature || ''))
      && collectionVerified(schedule.mint, request.sourceSignature)
      && settlementMatches(kind, request.sourceSignature, amount(request.amount))
      && (kind === 'holder' ? (() => {
        const pool = rewards.rewardPools?.[sourceIds[index]];
        return pool?.mint === schedule.mint && pool.asset === 'SOL'
          && pool.balanceDeltaVerified === true && pool.fundingSignature === request.fundingSignature
          && String(pool.amount) === String(request.amount);
      })() : schedule.fundingSignature === request.fundingSignature && schedule.balanceDeltaVerified === true));
    const leaves = new Map((schedule.manifest?.leaves || []).map(leaf => [leaf.recipient, leaf]));
    for (const [wallet, payment] of Object.entries(schedule.payments || {})) {
      if (payment?.status !== 'paid') continue;
      if (!sourceReady && payment.finalized === true && payment.balanceDeltaVerified === true)
        unlinkedPayments[kind] += 1;
      const units = amount(payment.amount);
      if (!sourceReady || !ADDRESS.test(wallet) || !SIGNATURE.test(String(payment.signature || ''))
        || payment.finalized !== true || payment.balanceDeltaVerified !== true
        || leaves.get(wallet)?.amount !== String(payment.amount) || units === null) {
        incomplete[kind] = true;
        continue;
      }
      const identity = kind === 'x' ? xIdentity(schedule.mint, requests[0].obligationId) : null;
      if (kind === 'x' && !identity) { incomplete.x = true; continue; }
      add(kind, wallet, payment.signature, units, identity);
    }
  }

  // Legacy X claims are paid directly from the per-mint router. Join each
  // receipt to its immutable obligation and the same verified fee collection.
  for (const payout of Object.values(state.payouts || {})) {
    if (payout?.source !== 'mint-router-settle-mint' || payout.status !== 'paid' || payout.cluster !== cluster) continue;
    const obligation = state.obligations?.[payout.obligationId];
    const claim = state.claims?.[payout.claimId];
    const proof = payoutProofs.get(`${payout.signature}:${payout.to}`);
    const units = payoutReceiptLamports(payout);
    const identity = xIdentity(payout.mint, payout.obligationId);
    if (!obligation || !claim || !identity || !collectionVerified(payout.mint, obligation.claimSignature)
      || obligation.id !== payout.obligationId || obligation.mint !== payout.mint
      || claim.obligationId !== obligation.id || String(claim.xUserId) !== identity.id
      || claim.publicKey !== payout.to || !ADDRESS.test(String(payout.to || ''))
      || !SIGNATURE.test(String(payout.signature || '')) || units === null
      || String(obligation.amountLamports) !== String(units)
      || !settlementMatches('x', obligation.claimSignature, BigInt(units))
      || proof?.source !== payout.source || proof.amountLamports !== units
      || !Number.isSafeInteger(proof.actualReceivedLamports) || proof.actualReceivedLamports <= 0) {
      incomplete.x = true;
      continue;
    }
    add('x', payout.to, payout.signature, BigInt(units), identity);
  }

  const result = { cluster, commitment:'finalized' };
  for (const kind of KINDS) {
    const payouts = [...rows.values()].filter(row => row.kind === kind);
    const groups = new Map();
    for (const row of payouts) {
      const key = kind === 'x' ? row.identity.id : row.wallet;
      const group = groups.get(key) || { recipient:key, handle:row.identity?.handle || null, paidLamports:0n, payoutCount:0 };
      group.paidLamports += row.amount;
      group.payoutCount += 1;
      groups.set(key, group);
    }
    const leader = [...groups.values()].sort((a, b) => a.paidLamports === b.paidLamports
      ? a.recipient.localeCompare(b.recipient) : a.paidLamports > b.paidLamports ? -1 : 1)[0];
    result[kind] = {
      paidLamports:payouts.reduce((sum, row) => sum + row.amount, 0n).toString(),
      payoutCount:payouts.length,
      top:leader ? { recipient:leader.recipient, handle:leader.handle,
        paidLamports:leader.paidLamports.toString(), payoutCount:leader.payoutCount } : null,
      status:evidence.status === 'partial' || incomplete[kind] ? 'partial' : 'verified',
      reason:unlinkedPayments[kind] ? `${unlinkedPayments[kind]} finalized reward transfer${unlinkedPayments[kind] === 1 ? '' : 's'} not linked to verified creator-fee funding` : null,
    };
  }
  result.fundedHolder = unavailable.fundedHolder;
  return result;
}
