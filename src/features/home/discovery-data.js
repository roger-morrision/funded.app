import { rankTrending, trendingMetric } from '../../../market-trending.js';

export const NEAR_GRADUATION_PERCENT = 70;

export function isNearGraduation(item) {
  return item.complete === false && item.migrated !== true
    && Number.isFinite(Number(item.curveProgressPercent))
    && Number(item.curveProgressPercent) >= NEAR_GRADUATION_PERCENT;
}

// Both Home surfaces share the same ranking and honest newest-first fallback.
export function homeTrendingSelection(records, period) {
  const ranked = rankTrending(records.filter(item => trendingMetric(item, period)?.score > 0), period);
  return { ranked: ranked.length > 0, records: ranked.length ? ranked : [...records].sort((a, b) =>
    Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0)
    || String(a.address || '').localeCompare(String(b.address || ''))) };
}
