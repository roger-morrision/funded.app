const positiveLamports = value => /^(?:0|[1-9]\d*)$/.test(String(value ?? '')) ? BigInt(value) : 0n;

export function homeLaunchFeeIndex(state, cluster) {
  const totals = new Map();
  const seen = new Set();
  for (const [mint, launch] of Object.entries(state?.launches || {})) {
    if (launch?.onchainVerified === true && launch.cluster === cluster
      && launch.pumpFeeRoute?.verified === true && launch.pumpFeeRoute?.scope === 'per-mint-v3'
      && launch.pumpFeeRoute.programId && launch.pumpFeeRoute.router === launch.creator) totals.set(mint, 0n);
  }
  for (const collection of Object.values(state?.collections || {})) {
    if (!totals.has(collection?.mint) || collection.cluster !== cluster || collection.status !== 'collected'
      || collection.attribution !== 'mint-verified' || collection.onchainVerified !== true || !collection.signature
      || collection.scope !== 'per-mint-v3' || seen.has(collection.signature)) continue;
    const launch = state.launches[collection.mint];
    if (collection.programId !== launch.pumpFeeRoute.programId || collection.router !== launch.creator) continue;
    seen.add(collection.signature);
    totals.set(collection.mint, totals.get(collection.mint) + positiveLamports(collection.collectedLamports));
  }
  return { cluster, coverage: 'verified-v3-collected-creator-fees-only',
    items: [...totals].map(([mint, collectedLamports]) => ({ mint, collectedLamports: collectedLamports.toString() })) };
}
