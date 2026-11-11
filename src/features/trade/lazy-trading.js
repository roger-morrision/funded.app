// Load transaction SDKs only when a market read or trade needs them.
// Mainnet: Pump.fun tokens (bonding curve or canonical PumpSwap pool) trade
// directly through the Pump SDK, with no aggregator rate limit; anything the
// direct path cannot build (other DEXs, legacy migrations) routes through Jupiter.
const MAINNET = import.meta.env?.VITE_SOLANA_CLUSTER === 'mainnet-beta';
const pumpCandidate = mint => /pump$/.test(String(mint?.toBase58?.() ?? mint ?? ''));
const pumpSdk = () => import('../../../pump-trading.js');
const jupiterSdk = () => import('../../../jupiter-trading.js');

export async function buildTradeTransaction(...args) {
  if (!MAINNET) return (await pumpSdk()).buildTradeTransaction(...args);
  if (pumpCandidate(args[0]?.mint)) {
    try { return await (await pumpSdk()).buildTradeTransaction(args[0]); } catch { /* fall back to Jupiter routing */ }
  }
  return (await jupiterSdk()).buildJupiterTrade(args[0]);
}
export async function buildVerifiedPoolTradeTransaction(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.buildVerifiedPoolTradeTransaction(...args); }
export async function fetchVerifiedPoolBuyQuote(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolBuyQuote(...args); }
export async function fetchBondingCurveSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchBondingCurveSnapshot(...args); }
export async function fetchGraduatedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchGraduatedPoolSnapshot(...args); }
export async function fetchVerifiedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolSnapshot(...args); }
export async function submitTrade(...args) {
  if (!MAINNET) return (await pumpSdk()).submitTrade(...args);
  const input = args[0] || {};
  if (input.preparedTrade && input.preparedTrade.route !== 'jupiter') return (await pumpSdk()).submitTrade(input);
  if (!input.preparedTrade && pumpCandidate(input.mint)) {
    // Build before any signing, so a failed direct build can still fall back safely.
    let prepared = null;
    try { prepared = await (await pumpSdk()).buildTradeTransaction(input); } catch { prepared = null; }
    if (prepared) return (await pumpSdk()).submitTrade({ ...input, preparedTrade: prepared });
  }
  return (await jupiterSdk()).submitJupiterTrade(input);
}
export async function fetchRichMarketSnapshot(...args) { const sdk = await import('../../../rich-market.js'); return sdk.fetchRichMarketSnapshot(...args); }
export async function buildRichTradeTransaction(...args) { const sdk = await import('../../../rich-market.js'); return sdk.buildRichTradeTransaction(...args); }
export async function fetchRichBuyQuote(...args) { const sdk = await import('../../../rich-market.js'); return sdk.fetchRichBuyQuote(...args); }
