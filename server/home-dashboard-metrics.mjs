const SOL_LAMPORTS = 1_000_000_000n;

function solLamports(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0n;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * Number(SOL_LAMPORTS)))) return 0n;
  return BigInt(Math.round(amount * Number(SOL_LAMPORTS)));
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
    const settlement = state.settlements?.[collection.signature];
    if (!proof || proof.mint !== collection.mint || proof.collectedLamports !== collection.collectedLamports
      || collection.cluster !== cluster || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified' || !launch?.onchainVerified || launch.cluster !== cluster
      || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator
      || settlement?.claimSignature !== collection.signature || settlement.asset !== 'SOL') continue;
    totals.appRevenueLamports += solLamports(settlement.fundedApp?.total);
    totals.holderLamports += solLamports(settlement.creatorDestinations?.holderAirdrop);
    totals.xLamports += solLamports(settlement.creatorDestinations?.solClaim);
    totals.buybackLamports += solLamports(settlement.fundedApp?.buyback);
    totals.communityLamports += solLamports(settlement.fundedApp?.community);
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
