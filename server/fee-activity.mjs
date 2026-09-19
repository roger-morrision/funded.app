export function coinFeeActivity(collections, settlements, mint, cluster) {
  const matches = Object.values(collections || {})
    .filter(item => item.mint === mint && item.signature && item.status === 'collected'
      && item.attribution === 'mint-verified' && (item.collectedLamports == null || Number(item.collectedLamports) > 0)
      && (!item.cluster || item.cluster === cluster))
    .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')));
  return {
    collections: matches.map(item => ({ signature: item.signature, recordedAt: item.recordedAt || null, collectedLamports: item.collectedLamports ?? null })),
    claims: matches.flatMap(item => {
      const settlement = settlements?.[item.signature];
      return settlement ? [{ claimSignature: item.signature, status: settlement.status || 'recorded', grossCreatorFees: settlement.grossCreatorFees ?? null, asset: settlement.asset || 'SOL', claimedAt: settlement.claimedAt || null }] : [];
    }),
  };
}

export function routerFeeActivity(collections, router, cluster) {
  return Object.values(collections || {})
    .filter(item => item.router === router && item.signature && item.status === 'collected'
      && item.attribution !== 'mint-verified' && Number(item.collectedLamports) > 0
      && (!item.cluster || item.cluster === cluster))
    .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')))
    .map(item => ({ signature: item.signature, recordedAt: item.recordedAt || null, collectedLamports: item.collectedLamports }));
}
