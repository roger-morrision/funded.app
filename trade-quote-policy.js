// Quotes remain bounded, while leaving enough time to review and sign over a
// slow Devnet RPC. The transaction still enforces the selected slippage limit.
export const TRADE_QUOTE_TTL_MS = 30_000;
export const TRADE_QUOTE_REFRESH_MS = 24_000;
export const TRADE_SIGNING_REFRESH_AFTER_MS = 10_000;
