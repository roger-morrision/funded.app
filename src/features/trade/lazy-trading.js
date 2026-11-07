// Load transaction SDKs only when a market read or trade needs them.
export async function buildTradeTransaction(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.buildTradeTransaction(...args); }
export async function buildVerifiedPoolTradeTransaction(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.buildVerifiedPoolTradeTransaction(...args); }
export async function fetchVerifiedPoolBuyQuote(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolBuyQuote(...args); }
export async function fetchBondingCurveSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchBondingCurveSnapshot(...args); }
export async function fetchGraduatedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchGraduatedPoolSnapshot(...args); }
export async function fetchVerifiedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolSnapshot(...args); }
export async function submitTrade(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.submitTrade(...args); }
