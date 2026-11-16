// Live data topics (shared by the server hub and the browser): public,
// visitor-independent API reads that the hub keeps warm, serves from its
// snapshot cache and pushes to browsers over /api/live.
// Every path here must return the same body for every visitor.

const MINT = '[1-9A-HJ-NP-Za-km-z]{32,44}';

// Shared reads most pages make at startup. `boot: false` keeps large bodies
// out of the single boot response; they are still cached and pushed.
export const GLOBAL_TOPICS = Object.freeze([
  { path: '/api/market/sol-usd', intervalMs: 15_000 },
  { path: '/api/home/featured', intervalMs: 30_000 },
  { path: '/api/pump/explore?limit=40&sort=last_trade_timestamp', intervalMs: 20_000 },
  { path: '/api/boosts', intervalMs: 30_000 },
  { path: '/api/launches', intervalMs: 30_000 },
  { path: '/api/buyback/status', intervalMs: 30_000 },
  { path: '/api/analytics/summary', intervalMs: 60_000 },
  { path: '/api/fee-policy', intervalMs: 300_000 },
  { path: '/api/service-fees', intervalMs: 300_000 },
  { path: '/api/capabilities', intervalMs: 120_000 },
  { path: '/api/callouts', intervalMs: 15_000 },
  { path: '/api/leaderboard/traders', intervalMs: 30_000 },
  { path: '/api/leaderboard/traders?window=24h', intervalMs: 30_000 },
  { path: '/api/leaderboard/traders?window=today', intervalMs: 30_000 },
  { path: '/api/rewards/automatic', intervalMs: 30_000 },
  { path: '/api/rewards/experience', intervalMs: 60_000 },
  { path: '/api/evidence/payment-history', intervalMs: 60_000 },
  { path: '/api/evidence/payment-history?limit=24', intervalMs: 60_000 },
  { path: '/api/evidence/receipts', intervalMs: 60_000 },
  { path: '/api/token-chat/feed', intervalMs: 15_000 },
  { path: '/api/top100/metrics', intervalMs: 60_000 },
  { path: '/api/x-fee/status', intervalMs: 120_000 },
  { path: '/api/pair-launch/status', intervalMs: 120_000 },
  { path: '/api/daily-bonus', intervalMs: 60_000 },
  { path: '/api/creator-support/issues/config', intervalMs: 300_000 },
  { path: '/api/pairs/quotes', intervalMs: 60_000, boot: false },
]);

// Per-token reads, kept warm only while a token page is subscribed.
const TOKEN_TOPICS = [
  [new RegExp(`^/api/tokens/${MINT}/overview$`), 15_000],
  [new RegExp(`^/api/tokens/${MINT}/trades$`), 20_000],
  [new RegExp(`^/api/tokens/${MINT}/market-activity$`), 20_000],
  [new RegExp(`^/api/tokens/${MINT}/holders$`), 120_000],
  [new RegExp(`^/api/tokens/${MINT}/ohlcv\\?frame=(?:1m|5m|15m|1h|4h|1d)$`), 60_000],
  [new RegExp(`^/api/tokens/${MINT}/chat$`), 15_000],
];

const GLOBAL_BY_PATH = new Map(GLOBAL_TOPICS.map(topic => [topic.path, topic]));

// Returns the topic for an exact request path (pathname + search), or null.
export function liveTopic(path) {
  if (typeof path !== 'string' || path.length > 200) return null;
  const global = GLOBAL_BY_PATH.get(path);
  if (global) return { ...global, global: true };
  for (const [pattern, intervalMs] of TOKEN_TOPICS) if (pattern.test(path)) return { path, intervalMs, global: false };
  return null;
}

// The token-page topics a browser subscribes to for one mint.
export function tokenTopicPaths(mint) {
  if (!new RegExp(`^${MINT}$`).test(mint || '')) return [];
  const base = `/api/tokens/${mint}`;
  return [`${base}/overview`, `${base}/trades`, `${base}/market-activity`, `${base}/holders`, `${base}/ohlcv?frame=15m`, `${base}/chat`];
}
