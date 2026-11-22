// Indexed Mainnet trades settle in SOL through Jupiter, even when the market's
// underlying pool is paired with SPCX, USDC, or another token. Pool pair metadata
// belongs to the market display and routing hints, not the wallet spend input.
export function indexedTradeEstimate(data, solUsd) {
  return { mint: data.mint, symbol: data.symbol || `${data.mint.slice(0, 4)}…`,
    curve: null, graduatedPool: null, decimals: Number.isInteger(data.decimals) ? data.decimals : 6,
    priceUsd: data.priceUsd, solUsd, dexId: data.dexId || null,
    quoteMint: null, quoteSymbol: 'SOL' };
}
