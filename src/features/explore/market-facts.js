// Presentation cache only. Never used to authorize a trade or calculate a quote.
const snapshots = new Map();
const STORAGE = 'funded.market-display.v1';
const fields = ['address','verifiedAt','complete','migrated','curveCapSol','poolMarketCapSol','curveReserveSol','poolReserveSol','source'];
const pick = item => Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key,item[key]]));
try {
  const saved = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE) || '[]');
  if (Array.isArray(saved)) for (const [key, item] of saved.slice(-1000)) {
    if (typeof key === 'string' && item && Number.isFinite(Date.parse(item.verifiedAt))) snapshots.set(key, pick(item));
  }
} catch {}
export function rememberMarketFacts(items, cluster) {
  for (const item of items) {
    if (!item.address || item.registryFallback || !Number.isFinite(Date.parse(item.verifiedAt))) continue;
    const key = `${cluster}:${item.address}`, before = snapshots.get(key);
    if (!before || Date.parse(item.verifiedAt) >= Date.parse(before.verifiedAt)) snapshots.set(key, pick(item));
    if (snapshots.size > 1000) snapshots.delete(snapshots.keys().next().value);
  }
  try { globalThis.sessionStorage?.setItem(STORAGE, JSON.stringify([...snapshots])); } catch {}
}
export function marketFacts(item, cluster = 'devnet') {
  const saved = snapshots.get(`${cluster}:${item.address}`);
  const current = !item.registryFallback && Number.isFinite(Date.parse(item.verifiedAt));
  return current && (!saved || Date.parse(item.verifiedAt) >= Date.parse(saved.verifiedAt)) ? item : saved ? {...item, ...saved, registryFallback:false} : item;
}
export function marketFreshness(item, cluster = 'devnet', now = Date.now()) {
  const facts = marketFacts(item, cluster), at = Date.parse(facts.verifiedAt);
  if (!Number.isFinite(at)) return 'Market data unavailable';
  const age = Math.max(0, Math.floor((now - at) / 1000));
  const label = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
  return `${item.registryFallback || age > 60 ? 'Last verified' : 'Checked'} ${label} ago · ${facts.source || 'Solana RPC'}`;
}
