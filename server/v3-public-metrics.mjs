import { communityHolderClaims } from './fee-payout-stats.mjs';
import { PAYOUT_COVERAGE_SCOPE } from './payout-coverage.mjs';

const safe = value => /^(0|[1-9]\d*)$/.test(String(value))
  && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(value) : null;
const number = value => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;

export function v3ReceiptEvidence(state, evidence, cluster) {
  const records = Object.values(state.collections || {}).filter(row => row.scope === 'per-mint-v3'
    && row.cluster === cluster && row.status === 'collected' && row.onchainVerified === true);
  const keys = new Map(records.map(row => [row.signature, row]));
  const verifiedCollections = (evidence?.cluster === cluster ? evidence.verifiedCollections || [] : [])
    .filter(row => keys.get(row.signature)?.mint === row.mint
      && String(keys.get(row.signature)?.collectedLamports) === String(row.collectedLamports));
  const sourceReady = evidence?.cluster === cluster && evidence.commitment === 'finalized'
    && ['onchain-indexed','partial','no-records'].includes(evidence.status);
  return { cluster, commitment:'finalized', generatedAt:evidence?.generatedAt || null,
    scope:'verified-v3-collections',
    status:!sourceReady ? 'unavailable' : records.length === 0 ? 'no-records'
      : verifiedCollections.length === records.length ? 'onchain-indexed' : 'partial',
    verifiedCollections, verifiedPayouts:[],
    coverage:{ recordedCollections:records.length, recordedPayouts:0,
      verifiedCollections:verifiedCollections.length, verifiedPayouts:0 } };
}

function payoutGroup(rows, source, partial = false) {
  const matched = rows.filter(row => row.source === source && safe(row.amountLamports) !== null);
  const total = matched.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n);
  const recipients = new Map();
  for (const row of matched) {
    const current = recipients.get(row.to) || { recipient:row.to, paidLamports:'0', payoutCount:0,
      handle:row.xHandle || null };
    current.paidLamports = String(BigInt(current.paidLamports) + BigInt(row.amountLamports));
    current.payoutCount++;
    recipients.set(row.to, current);
  }
  const top = [...recipients.values()].sort((a,b) => BigInt(a.paidLamports) === BigInt(b.paidLamports)
    ? a.recipient.localeCompare(b.recipient)
    : BigInt(a.paidLamports) > BigInt(b.paidLamports) ? -1 : 1)[0] || null;
  return { paidLamports:total.toString(), payoutCount:matched.length, top,
    status:partial ? 'partial' : 'verified' };
}

export function v3PublicMetrics(state, evidence, history, rewards, cluster) {
  const receipts = v3ReceiptEvidence(state, evidence, cluster);
  const recorded = Object.values(state.collections || {}).filter(row => row.scope === 'per-mint-v3'
    && row.cluster === cluster && row.status === 'collected' && row.onchainVerified === true);
  const proved = new Set(receipts.verifiedCollections.map(row => row.signature));
  const verified = recorded.filter(row => proved.has(row.signature));
  const settled = verified.filter(row => state.v3Settlements?.[row.signature]?.status === 'finalized'
    && state.v3Settlements[row.signature].allocationPlan?.status === 'allocated-not-funded');
  const payments = history?.cluster === cluster && history.commitment === 'finalized'
    ? history.verifiedPayouts || [] : [];
  const partialPayouts = history?.status !== 'onchain-indexed';
  const holder = payoutGroup(payments,'automatic-holder',partialPayouts);
  const daily = payoutGroup(payments,'daily-bonus',partialPayouts);
  const x = payoutGroup(payments,'automatic-x',partialPayouts);
  const creator = history?.cluster === cluster && history.commitment === 'finalized'
    ? payoutGroup(payments,'v3-creator-wallet',partialPayouts)
    : { paidLamports:null, payoutCount:null, top:null, status:'unavailable',
      reason:'Finalized creator payout history is unavailable.' };
  const community = communityHolderClaims(rewards?.communityClaimIndex, cluster);
  const collected = verified.reduce((sum,row) => sum + BigInt(safe(row.collectedLamports) || 0n),0n);
  const recordedTotal = recorded.reduce((sum,row) => sum + BigInt(safe(row.collectedLamports) || 0n),0n);
  const referral = history?.cluster === cluster && history.commitment === 'finalized'
    && ['verified','partial'].includes(history.referralSummary?.status) ? history.referralSummary : null;
  const referralPaid = safe(referral?.paidLamports) ?? 0n;
  const referralCount = Number.isSafeInteger(referral?.payoutCount) && referral.payoutCount >= 0 ? referral.payoutCount : 0;
  const coverage = history?.cluster === cluster && history.commitment === 'finalized'
    && history.payoutCoverage?.scope === PAYOUT_COVERAGE_SCOPE ? history.payoutCoverage : null;
  const coverageValid = ['verified','partial'].includes(coverage?.status)
    && Number.isSafeInteger(coverage.recorded) && Number.isSafeInteger(coverage.verified)
    && coverage.verified >= 0 && coverage.recorded >= coverage.verified;
  const paid = coverage ? !/^(0|[1-9]\d*)$/.test(String(coverage.verifiedTotalLamports)) ? null : BigInt(coverage.verifiedTotalLamports)
    : payments.reduce((sum,row) => sum + BigInt(safe(row.amountLamports) || 0n),0n) + referralPaid;
  const buyback = settled.reduce((sum,row) => sum
    + BigInt(safe(state.v3Settlements[row.signature].allocationPlan.protocol?.buybackLamports) || 0n),0n);
  const status = receipts.status === 'onchain-indexed' ? 'indexed'
    : receipts.status === 'no-records' ? 'no-records' : receipts.status;
  const precisionUnavailableFields = [
    ['recordedCollectedLamports',recordedTotal],['collectedLamports',collected],
    ['finalizedPaidLamports',paid],
    ['referralPaidLamports',referralPaid],
    ['dailyBonusPaidLamports',BigInt(daily.paidLamports)],
  ].filter(([,amount])=>amount !== null && number(amount)===null).map(([field])=>field);
  return { status, precisionStatus:precisionUnavailableFields.length ? 'overflow' : 'safe',
    precisionUnavailableFields,
    exactLamports:{ recordedCollectedLamports:String(recordedTotal),
      collectedLamports:String(collected), finalizedPaidLamports:paid === null ? null : String(paid), referralPaidLamports:String(referralPaid),
      dailyBonusPaidLamports:daily.paidLamports },
    receiptCommitment:'finalized', receiptScope:'verified-v3-collections',
    recordedCollections:recorded.length, recordedCollectedLamports:number(recordedTotal),
    collections:verified.length, settlements:settled.length,
    grossCreatorFees:Number(settled.reduce((sum,row)=>sum
      + BigInt(safe(row.collectedLamports) || 0n),0n))/1_000_000_000,
    collectedLamports:number(collected), buybackAccrued:Number(buyback)/1_000_000_000,
    finalizedPaidLamports:paid === null ? null : number(paid), referralPaidLamports:referral ? number(referralPaid) : null,
    referralPayoutCount:referral ? referralCount : null, referralEvidenceStatus:referral?.status || 'unavailable',
    recordedPayouts:coverageValid ? coverage.recorded : null,
    payoutCoverage:{scope:PAYOUT_COVERAGE_SCOPE,status:coverageValid ? coverage.status : 'unavailable',
      reason:coverageValid ? null : coverage?.reason || 'A common recorded and verified payout scope is unavailable.'},
    dailyBonusPaidLamports:number(BigInt(daily.paidLamports)), dailyBonusPayoutCount:daily.payoutCount,
    dailyBonusEvidenceStatus:history?.dailyBonusSummary?.status || 'unavailable',
    verifiedPayoutCount:coverageValid ? coverage.verified : null, payoutEvidenceAt:history?.generatedAt || null,
    rewardPaid:{ cluster, commitment:'finalized', holder:{ ...holder, top:undefined },
      x:{ ...x, top:undefined } },
    feePayoutStats:{ cluster, commitment:'finalized', holder, x, creator,
      fundedHolder:community },
    v3Evidence:receipts };
}
