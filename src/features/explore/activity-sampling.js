export const ACTIVITY_MAX_AGE_MS = 5 * 60_000;
const valid = data => data && Object.hasOwn(data, 'observedCoverage')
  && (data.tradeCount24h == null || (data.activityWindows?.['1h'] && data.activityWindows?.['6h']
    && data.activityWindows?.['24h'] && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h)));

export async function scanExploreMarketsBounded(items, scan) {
  let next = 0;
  await Promise.all(Array.from({ length:Math.min(4, items.length) }, async () => {
    while (next < items.length) await scan(items[next++]);
  }));
}

export function applyActivitySnapshot(item, market, at) {
  const number = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  item.volume24hSol = number(market.volume24hSol);
  item.volumeCoverage = market.coverage;
  item.observedVolumeSol = number(market.observedVolumeSol);
  item.observedCoverage = market.observedCoverage || 'unavailable';
  for (const key of ['tradeCount24h', 'buyCount24h', 'sellCount24h']) {
    const value = number(market[key]); item[key] = Number.isInteger(value) ? value : null;
  }
  const traders = number(market.activityWindows?.['24h']?.traderCount);
  item.traderCount24h = Number.isInteger(traders) ? traders : null;
  item.recentTrades = Array.isArray(market.recentTrades) ? market.recentTrades : [];
  item.activityWindows = market.activityWindows && ['1h','6h','24h'].every(period => market.activityWindows[period]) ? market.activityWindows : null;
  item.marketActivityObservedAt = at;
  const latest = Number(market.recentTrades?.[0]?.blockTime);
  if (Number.isFinite(latest) && latest > 0) item.lastTradeUnixTime = latest;
  if (market.priceChangeBasis === '24h' && market.priceChangePercent != null && Number.isFinite(Number(market.priceChangePercent))) {
    item.priceChange24hPercent = Number(market.priceChangePercent);
    item.change = `${item.priceChange24hPercent >= 0 ? '+' : ''}${item.priceChange24hPercent.toFixed(2)}%`;
  }
}

// Match the server's minute window, leaving one of its six fresh scans for a
// token-detail request. Sorting and manual refresh cannot reset this budget.
export function createExploreActivitySampler({ cache, now = Date.now }) {
  let minute = -1, spent = 0;
  const attempted = new Map();
  return async function refresh(items, request, signal) {
    const time = now(), currentMinute = Math.floor(time / 60_000);
    if (currentMinute !== minute) { minute = currentMinute; spent = 0; }
    const recent = item => {
      const row = cache.get(item.address);
      const age = row ? now() - row.at : Infinity;
      return row && age >= 0 && age < ACTIVITY_MAX_AGE_MS && valid(row.data) ? row : null;
    };
    const pending = items.filter(item => !recent(item))
      .sort((a,b) => (attempted.get(a.address) || 0) - (attempted.get(b.address) || 0));
    const batch = pending.slice(0,Math.max(0,5-spent));
    spent += batch.length;
    await scanExploreMarketsBounded(batch, async item => {
      signal?.throwIfAborted(); attempted.set(item.address,time);
      const market = await request(item);
      if (!valid(market)) return;
      if (cache.size >= 500 && !cache.has(item.address)) cache.delete(cache.keys().next().value);
      const observed = Date.parse(market.observedAt || '');
      cache.set(item.address,{at:Number.isFinite(observed) ? observed : now(),data:market});
    });
    let count = 0;
    for (const item of items) {
      const row = recent(item);
      if (row) { applyActivitySnapshot(item,row.data,row.at); count++; }
      else applyActivitySnapshot(item,{observedCoverage:'unavailable',coverage:'unavailable'},null);
    }
    const current = new Set(items.map(item => item.address));
    for (const key of attempted.keys()) if (!current.has(key)) attempted.delete(key);
    return count;
  };
}

export function renderActivityCoverage(document, id, records, { hidden = false } = {}) {
  const node = document.getElementById?.(id) || document.querySelector?.(`#${id}`);
  if (!node) return;
  node.hidden = hidden;
  if (hidden) return;
  const known = records.filter(item => item.windowVolumeSol != null).length;
  const partial = known < records.length || records.some(item => item.windowCoverage === 'partial');
  node.dataset.state = partial ? 'partial' : known ? 'available' : 'unavailable';
  node.textContent = !records.length ? 'Activity data will appear after launches are verified.'
    : `Activity: ${known}/${records.length} tokens checked. ${known < records.length
      ? 'Rankings and activity filters are partial. More tokens are checked on refresh.'
      : partial ? 'Some trade histories are incomplete.' : 'All listed tokens have snapshots.'} Snapshots may be up to 5 min old.`;
}
