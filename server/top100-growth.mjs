const DAY = 86_400_000, INTERVAL = 300_000, GAP = 600_000;
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Persist server observations only. Five-minute samples retain 26 hours;
// a missing opening sample is never replaced by zero or a since-launch value.
export async function recordTop100Snapshot(store, cluster, mint, metric, value, at = Date.now()) {
  if (!['marketCapUsd','holders'].includes(metric) || !valid(value)
    || (metric === 'holders' && !Number.isSafeInteger(value)) || !Number.isFinite(at)) return;
  if (typeof store.update !== 'function') return;
  await store.update(state => {
    state.top100Snapshots ||= {};
    const key = `${cluster}:${mint}`, entry = state.top100Snapshots[key] ||= {cluster,mint};
    if (entry[`${metric}Latest`]?.at > at) return;
    const rows = (entry[metric] || []).filter(row => row.at >= at - DAY - 2 * 3600000 && row.at <= at);
    // Keep the opening observation of each bucket and a fresh latest value.
    if (!rows.length || at - rows.at(-1).at >= INTERVAL) rows.push({at,value});
    entry[metric] = rows.slice(-314);
    entry[`${metric}Latest`] = {at,value};
  });
}

export function top100Growth(snapshots = {}, cluster, now = Date.now()) {
  const items = {};
  for (const row of Object.values(snapshots || {})) {
    if (row.cluster !== cluster || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint || '')) continue;
    const result = {};
    for (const metric of ['marketCapUsd','holders']) {
      const latest = row[`${metric}Latest`];
      const opening = (row[metric] || []).filter(point => valid(point.value)
        && Number.isFinite(point.at) && point.at <= now - DAY && now - DAY - point.at <= GAP)
        .sort((a,b) => b.at-a.at)[0];
      result[metric] = latest && valid(latest.value) && now >= latest.at && now-latest.at < INTERVAL && opening
        ? {delta:latest.value-opening.value,from:opening.at,to:latest.at} : null;
    }
    items[row.mint] = result;
  }
  return {scope:'net-change-24h',observedAt:now,items};
}
