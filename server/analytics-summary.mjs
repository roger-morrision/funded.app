const lamports = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value))) return 0;
  const units = Number(value);
  return Number.isSafeInteger(units) && units > 0 ? units : 0;
};
const sol = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const solLamports = value => {
  const amount = Number(value);
  const units = Math.round(amount * 1_000_000_000);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(units) ? units : null;
};
const exactTotal = (rows, field) => rows.reduce((sum, row) => sum + BigInt(lamports(row[field])), 0n);
const safeTotal = value => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;

export function analyticsReceiptTotals(state, evidence, cluster) {
  const recorded = Object.values(state.collections || {}).filter(row => row.cluster === cluster
    && row.status === 'collected' && row.attribution === 'mint-verified' && row.onchainVerified === true && lamports(row.collectedLamports));
  const evidenceReady = evidence?.cluster === cluster && evidence.commitment === 'finalized'
    && ['onchain-indexed', 'partial', 'no-records'].includes(evidence.status);
  const proofs = new Map((evidenceReady ? evidence.verifiedCollections || [] : []).map(row => [row.signature, row]));
  const collections = recorded.filter(row => {
    const proof = proofs.get(row.signature);
    const launch = state.launches?.[row.mint];
    return proof?.mint === row.mint && proof.collectedLamports === row.collectedLamports
      && launch?.onchainVerified === true && launch.cluster === cluster;
  });
  const settlements = collections.flatMap(collection => {
    const row = state.settlements?.[collection.signature];
    return row?.claimSignature === collection.signature && row.asset === 'SOL'
      && solLamports(row.grossCreatorFees) === collection.collectedLamports ? [row] : [];
  });
  const verifiedPayouts = evidenceReady ? evidence.verifiedPayouts || [] : [];
  const referralPayouts = verifiedPayouts.filter(row => row.source === 'solana-keeper-referral-claim');
  // Individual safe integers can still overflow when added. Preserve exact
  // base units and withhold only the incompatible numeric representation.
  const exact = {
    recordedCollectedLamports:exactTotal(recorded, 'collectedLamports'),
    collectedLamports:exactTotal(collections, 'collectedLamports'),
    finalizedPaidLamports:exactTotal(verifiedPayouts, 'amountLamports'),
    referralPaidLamports:exactTotal(referralPayouts, 'amountLamports'),
  };
  const numeric = Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, safeTotal(value)]));
  const precisionUnavailableFields = Object.keys(numeric).filter(key => numeric[key] === null);
  const status = !evidenceReady ? recorded.length && evidence?.status === 'unverified-records' ? 'recorded-claims-only' : 'unavailable'
    : evidence.status === 'partial' ? 'partial'
      : evidence.status === 'no-records' ? recorded.length ? 'recorded-claims-only' : 'no-records'
      : collections.length === recorded.length ? 'indexed' : 'partial';
  return {
    status,
    precisionStatus: precisionUnavailableFields.length ? 'overflow' : 'safe',
    precisionUnavailableFields,
    exactLamports: Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, value.toString()])),
    receiptCommitment: 'finalized',
    receiptScope: evidence?.scope || 'global-recent',
    recordedCollections: recorded.length,
    recordedCollectedLamports: numeric.recordedCollectedLamports,
    collections: collections.length,
    settlements: settlements.length,
    grossCreatorFees: settlements.reduce((sum, row) => sum + sol(row.grossCreatorFees), 0),
    collectedLamports: numeric.collectedLamports,
    buybackAccrued: settlements.reduce((sum, row) => sum + sol(row.fundedApp?.buyback), 0),
    finalizedPaidLamports: numeric.finalizedPaidLamports,
    referralPaidLamports: numeric.referralPaidLamports,
    referralPayoutCount: referralPayouts.length,
    recordedPayouts: Number(evidence?.coverage?.recordedPayouts || 0),
    verifiedPayoutCount: verifiedPayouts.length,
  };
}
