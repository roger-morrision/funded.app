export const EXPLORE_FILTER_KEYS = ['explore-search', 'explore-sort', 'explore-promotion-filter', 'explore-reward-filter', 'explore-risk-filter', 'explore-max-age-hours', 'explore-authority-filter', 'explore-min-volume-sol', 'explore-min-cap-sol', 'explore-min-trades', 'explore-min-traders', 'stage', 'tab', 'window', 'view'];

export function sanitizeExploreFilters(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(EXPLORE_FILTER_KEYS.filter(key => typeof input[key] === 'string' && input[key].length < 200).map(key => [key, input[key]]));
}

export function readExploreFilterUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.searchParams.get('filters') !== '1') return null;
  return sanitizeExploreFilters(Object.fromEntries(EXPLORE_FILTER_KEYS.map(key => [key, url.searchParams.get(`f.${key}`) || ''])));
}

export function exploreFilterUrl(origin, filters) {
  const url = new URL('/explore', origin);
  url.searchParams.set('filters', '1');
  for (const [key, value] of Object.entries(sanitizeExploreFilters(filters))) if (value) url.searchParams.set(`f.${key}`, value);
  return url.href;
}
