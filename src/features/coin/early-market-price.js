// Publish verified price fields independently of holder scans and fee history.
export function renderEarlyMarketPrice(appState,{mintInfo,curve,pool}) {
  const parsed=mintInfo.value.data.parsed.info;
  const supply=Number(parsed.supply)/(10**parsed.decimals);
  const spot=pool?.spotPriceSol ?? (curve?.complete===false && curve.virtualTokenReserves>0
    ? curve.virtualQuoteReservesSol/curve.virtualTokenReserves : NaN);
  if (!Number.isFinite(spot) || spot<=0) return;
  appState.coinSolUsdValues={spot,marketCap:spot*supply,reserve:pool?.quoteReservesSol ?? curve?.realQuoteReservesSol,
    virtualQuote:curve?.virtualQuoteReservesSol ?? NaN,supply};
  appState.setCoinField('#coin-price',appState.formatCoinSnapshotUsd(spot));
  appState.setCoinField('#coin-liquidity',appState.formatCoinSnapshotUsd(spot));
  for (const selector of ['#coin-market-cap','#coin-strip-market-cap']) appState.setCoinField(selector,appState.formatCoinUsd(spot*supply));
  appState.setCoinFact('#coin-stage',pool?'Migrated · PumpSwap':'On Pump curve','clear');
  appState.setCoinField('#coin-market-cap-source',pool?'PumpSwap vault ratio · indicative RPC snapshot':'Confirmed Pump curve RPC snapshot');
}
