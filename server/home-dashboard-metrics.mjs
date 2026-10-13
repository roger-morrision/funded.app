function lamports(value) {
  return /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : 0n;
}

export function homeFeeAllocationSummary(state, evidence, cluster) {
  const coverage = evidence?.coverage || {};
  const recordedCollections = Number(coverage.recordedCollections || 0);
  const evidenceReady = evidence?.cluster === cluster
    && (['onchain-indexed', 'partial'].includes(evidence.status) || (evidence.status === 'no-records' && recordedCollections === 0));
  const verified = new Map((evidenceReady ? evidence.verifiedCollections || [] : [])
    .map(row => [row.signature, row]));
  const totals = { appRevenueLamports:0n, holderLamports:0n, xLamports:0n, buybackLamports:0n, communityLamports:0n };
  let settledCollections = 0;
  for (const collection of Object.values(state.collections || {})) {
    const proof = verified.get(collection.signature);
    const launch = state.launches?.[collection.mint];
    const settlement = state.v3Settlements?.[collection.signature];
    const plan = settlement?.allocationPlan;
    if (!proof || proof.mint !== collection.mint || proof.collectedLamports !== collection.collectedLamports
      || collection.cluster !== cluster || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.scope !== 'per-mint-v3' || !launch?.onchainVerified || launch.cluster !== cluster
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.pumpFeeRoute.router !== launch.creator
      || settlement?.status !== 'finalized' || settlement.mint !== collection.mint
      || plan?.status !== 'allocated-not-funded'
      || lamports(plan.grossLamports) !== lamports(collection.collectedLamports)) continue;
    totals.appRevenueLamports += lamports(plan.protocol?.operationsLamports)
      + (plan.protocol?.referralLamports || []).reduce((sum, row) => sum + lamports(row), 0n)
      + lamports(plan.protocol?.communityLamports) + lamports(plan.protocol?.buybackLamports);
    totals.holderLamports += lamports(plan.creatorDirected?.holderLamports);
    totals.xLamports += lamports(plan.creatorDirected?.xLamports);
    totals.buybackLamports += lamports(plan.protocol?.buybackLamports);
    totals.communityLamports += lamports(plan.protocol?.communityLamports);
    settledCollections += 1;
  }

  const burns = new Map();
  for (const launch of Object.values(state.launches || {})) {
    const burn = launch.creatorLaunchBurn;
    if (launch.cluster === cluster && launch.onchainVerified && burn?.status === 'verified'
      && burn.receipt?.signature && Number(burn.receipt.amountTokens ?? burn.amountTokens) > 0) {
      burns.set(burn.receipt.signature, Number(burn.receipt.amountTokens ?? burn.amountTokens));
    }
  }
  for (const receipt of Object.values(state.burnReceipts || {})) {
    if (receipt.cluster === cluster && receipt.status === 'verified' && receipt.onchainVerified === true
      && receipt.signature && Number(receipt.amountTokens) > 0) burns.set(receipt.signature, Number(receipt.amountTokens));
  }
  const partial = evidenceReady && (evidence.status === 'partial' || (evidence.verifiedCollections || []).length < recordedCollections);
  return {
    cluster,
    status:evidenceReady ? partial ? 'partial' : 'verified' : 'unavailable',
    scope:'verified-recent-collection-receipts',
    recordedCollections,
    verifiedCollections:verified.size,
    settledCollections,
    ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toString()])),
    verifiedBurnCount:burns.size,
    burnedTokens:[...burns.values()].reduce((sum, amount) => sum + amount, 0),
  };
}
