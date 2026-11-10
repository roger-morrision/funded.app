// Load transaction SDKs only when a market read or trade needs them.
// Mainnet routes every token (Pump curve, PumpSwap and other DEXs) through Jupiter.
const MAINNET = import.meta.env?.VITE_SOLANA_CLUSTER === 'mainnet-beta';
export async function buildTradeTransaction(...args) {
  if (MAINNET) { const jup = await import('../../../jupiter-trading.js'); return jup.buildJupiterTrade(args[0]); }
  const sdk = await import('../../../pump-trading.js'); return sdk.buildTradeTransaction(...args);
}
export async function buildVerifiedPoolTradeTransaction(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.buildVerifiedPoolTradeTransaction(...args); }
export async function fetchVerifiedPoolBuyQuote(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolBuyQuote(...args); }
export async function fetchBondingCurveSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchBondingCurveSnapshot(...args); }
export async function fetchGraduatedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchGraduatedPoolSnapshot(...args); }
export async function fetchVerifiedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolSnapshot(...args); }
export async function submitTrade(...args) {
  if (MAINNET) { const jup = await import('../../../jupiter-trading.js'); return jup.submitJupiterTrade(args[0]); }
  const sdk = await import('../../../pump-trading.js'); return sdk.submitTrade(...args);
}
export async function fetchRichMarketSnapshot(...args) { const sdk = await import('../../../rich-market.js'); return sdk.fetchRichMarketSnapshot(...args); }
export async function buildRichTradeTransaction(...args) { const sdk = await import('../../../rich-market.js'); return sdk.buildRichTradeTransaction(...args); }
export async function fetchRichBuyQuote(...args) { const sdk = await import('../../../rich-market.js'); return sdk.fetchRichBuyQuote(...args); }
