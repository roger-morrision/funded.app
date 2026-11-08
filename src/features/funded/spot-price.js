export function fundedSpotUsd({mint,route,asset,solUsd}) {
  if (!mint) return null;
  const solReady = Number.isFinite(solUsd) && solUsd > 0;
  const pool = route?.status === 'ready' && route.snapshot?.mint === mint ? route.snapshot : null;
  const poolSol = Number(pool?.spotPriceSol);
  if (pool && solReady && Number.isFinite(poolSol) && poolSol > 0) return poolSol * solUsd;
  if (asset?.address !== mint) return null;
  const usd = Number(asset.priceUsd);
  if (Number.isFinite(usd) && usd > 0) return usd;
  const spot = Number(asset.migrated === true ? asset.poolPriceSol : asset.curvePriceSol);
  return solReady && Number.isFinite(spot) && spot > 0 ? spot * solUsd : null;
}
