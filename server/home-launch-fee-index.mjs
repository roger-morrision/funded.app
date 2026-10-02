const positiveLamports = value => /^(?:0|[1-9]\d*)$/.test(String(value ?? '')) ? BigInt(value) : 0n;

export function homeLaunchFeeIndex(state, cluster) {
  const totals = new Map();
  for (const [mint, launch] of Object.entries(state?.launches || {})) {
    if (launch?.onchainVerified === true && launch.cluster === cluster
      && launch.pumpFeeRoute?.scope === 'per-mint-v2' && launch.pumpFeeRoute.router === launch.creator) totals.set(mint, 0n);
  }
  for (const collection of Object.values(state?.collections || {})) {
    if (!totals.has(collection?.mint) || collection.cluster !== cluster || collection.status !== 'collected'
      || collection.attribution !== 'mint-verified' || collection.onchainVerified !== true || !collection.signature) continue;
    totals.set(collection.mint, totals.get(collection.mint) + positiveLamports(collection.collectedLamports));
  }
  return { cluster, coverage: 'mint-verified-collected-creator-fees-only',
    items: [...totals].map(([mint, collectedLamports]) => ({ mint, collectedLamports: collectedLamports.toString() })) };
}
