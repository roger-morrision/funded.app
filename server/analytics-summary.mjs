const lamports = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const sol = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const solLamports = value => {
  const amount = Number(value);
  const units = Math.round(amount * 1_000_000_000);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(units) ? units : null;
};

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
  const status = !evidenceReady ? recorded.length && evidence?.status === 'unverified-records' ? 'recorded-claims-only' : 'unavailable'
    : evidence.status === 'partial' ? 'partial'
      : evidence.status === 'no-records' ? recorded.length ? 'recorded-claims-only' : 'no-records'
      : collections.length === recorded.length ? 'indexed' : 'partial';
  return {
    status,
    receiptCommitment: 'finalized',
    receiptScope: evidence?.scope || 'global-recent',
    recordedCollections: recorded.length,
    recordedCollectedLamports: recorded.reduce((sum, row) => sum + lamports(row.collectedLamports), 0),
    collections: collections.length,
    settlements: settlements.length,
    grossCreatorFees: settlements.reduce((sum, row) => sum + sol(row.grossCreatorFees), 0),
    collectedLamports: collections.reduce((sum, row) => sum + lamports(row.collectedLamports), 0),
    buybackAccrued: settlements.reduce((sum, row) => sum + sol(row.fundedApp?.buyback), 0),
    finalizedPaidLamports: verifiedPayouts.reduce((sum, row) => sum + lamports(row.amountLamports), 0),
    referralPaidLamports: referralPayouts.reduce((sum, row) => sum + lamports(row.amountLamports), 0),
    referralPayoutCount: referralPayouts.length,
    recordedPayouts: Number(evidence?.coverage?.recordedPayouts || 0),
    verifiedPayoutCount: verifiedPayouts.length,
  };
}
