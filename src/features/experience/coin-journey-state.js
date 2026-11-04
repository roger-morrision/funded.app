// Retain the latest result so a lazily mounted panel cannot miss a fast read.
let latest = null;
export function rememberCoinJourney(detail, now = performance.now()) {
  const startedAt = detail.status === 'loading' || latest?.mint !== detail.mint ? now : latest.startedAt;
  latest = {...detail, startedAt, elapsedMs:Math.max(0, now-startedAt)};
  return latest;
}
export function currentCoinJourney(mint) { return latest?.mint === mint ? latest : null; }
