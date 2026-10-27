const pendingBySync = new WeakMap();

function currentKey(sync, mint) {
  if (!sync || !['object', 'function'].includes(typeof sync) || typeof sync.identity !== 'function'
    || typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
  const owner = sync.identity();
  if (owner === null || typeof owner === 'string' && /^(?:\d{1,24}|wallet:[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(owner)) return { owner, mint };
}

export function isWatchlistRetryPending(sync, mint) {
  const key = currentKey(sync, mint);
  return Boolean(key && pendingBySync.get(sync)?.get(key.owner)?.get(key.mint)?.size);
}

export function beginWatchlistRetry(sync, mint) {
  const key = currentKey(sync, mint);
  if (!key) return () => {};
  let owners = pendingBySync.get(sync);
  if (!owners) pendingBySync.set(sync, owners = new Map());
  let mints = owners.get(key.owner);
  if (!mints) owners.set(key.owner, mints = new Map());
  let tokens = mints.get(key.mint);
  if (!tokens) mints.set(key.mint, tokens = new Set());
  const token = Symbol();
  tokens.add(token);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    tokens.delete(token);
    if (!tokens.size && mints.get(key.mint) === tokens) mints.delete(key.mint);
    if (!mints.size && owners.get(key.owner) === mints) owners.delete(key.owner);
    if (!owners.size && pendingBySync.get(sync) === owners) pendingBySync.delete(sync);
  };
}
