// 24h volume change for token cards. No free market feed reports the previous
// day's volume, so this keeps an hourly snapshot of each listed coin's 24h
// volume and compares the current figure with the snapshot taken closest to
// 24 hours earlier. Until a coin has a day of history the change stays null.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOW = 3 * HOUR;

export function createVolumeChangeTracker({ store, cluster, now = Date.now }) {
  const key = `${cluster}:volume-24h-history`;
  const history = new Map();
  const loaded = new Map();
  async function snapshots(mint) {
    if (!loaded.has(mint)) {
      loaded.set(mint, (async () => {
        const saved = await store.readMarketActivity?.(mint, key).catch(() => null);
        const rows = Array.isArray(saved?.snapshots) ? saved.snapshots.filter(row => Number.isFinite(row?.at) && Number.isFinite(row?.usd)) : [];
        history.set(mint, rows);
      })());
    }
    await loaded.get(mint);
    return history.get(mint) || [];
  }
  // Record the current 24h volume at most once an hour per coin.
  async function record(mint, usd) {
    if (!Number.isFinite(usd) || usd < 0 || typeof store.writeMarketActivity !== 'function') return;
    const rows = await snapshots(mint), at = now();
    if (rows.length && at - rows[rows.length - 1].at < HOUR) return;
    const next = [...rows, { at, usd }].filter(row => at - row.at <= DAY + WINDOW);
    history.set(mint, next);
    await store.writeMarketActivity(mint, key, { snapshots: next, observedAt: new Date(at).toISOString() }).catch(() => {});
  }
  // Percentage change against the snapshot nearest to 24h ago (within ±3h).
  async function change(mint, usd) {
    if (!Number.isFinite(usd)) return null;
    const at = now();
    const base = (await snapshots(mint))
      .filter(row => Math.abs(at - row.at - DAY) <= WINDOW)
      .sort((a, b) => Math.abs(at - a.at - DAY) - Math.abs(at - b.at - DAY))[0];
    return base && base.usd > 0 ? (usd - base.usd) / base.usd * 100 : null;
  }
  return { record, change };
}
