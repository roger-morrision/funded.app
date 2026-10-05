export const BOOST_PACKAGES = Object.freeze([
  { id: '10x', multiplier: 10, hours: 12, usd: 99 },
  { id: '30x', multiplier: 30, hours: 12, usd: 249 },
  { id: '50x', multiplier: 50, hours: 12, usd: 399 },
  { id: '100x', multiplier: 100, hours: 24, usd: 899 },
  { id: '500x', multiplier: 500, hours: 24, usd: 3999 },
]);

export const BOOST_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export function boostPackage(id) {
  return BOOST_PACKAGES.find(item => item.id === id) || null;
}

export function boostLamports(usd, solUsd) {
  if (!Number.isFinite(solUsd) || solUsd <= 0 || !Number.isFinite(usd) || usd <= 0) throw new Error('A live SOL/USD quote is required.');
  const lamports = Math.ceil(usd / solUsd * 1_000_000_000);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error('Boost amount is outside the supported range.');
  return lamports;
}

export function boostMemo(id) { return `funded.vip:boost:devnet:${id}`; }

export function activeBoostPackages(boost, now = Date.now()) {
  if (!Array.isArray(boost?.packages)) return [];
  return boost.packages.filter(row => {
    const pack = boostPackage(row?.packageId);
    return pack && pack.multiplier === row.multiplier
      && Number.isFinite(Date.parse(row.startsAt)) && Date.parse(row.startsAt) <= now
      && Number.isFinite(Date.parse(row.expiresAt)) && Date.parse(row.expiresAt) > now;
  }).sort((a, b) => b.multiplier - a.multiplier || Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

export function activeBoostMultiplier(boost, now = Date.now()) {
  if (Array.isArray(boost?.packages)) return activeBoostPackages(boost, now).reduce((total, row) => total + row.multiplier, 0);
  const multiplier = Number(boost?.multiplier);
  const expiresAt = Date.parse(boost?.expiresAt);
  const nextExpiry = Date.parse(boost?.nextExpiry || boost?.expiresAt);
  return Number.isSafeInteger(multiplier) && multiplier > 0 && Number.isFinite(expiresAt) && expiresAt > now
    && Number.isFinite(nextExpiry) && nextExpiry > now
    ? multiplier : 0;
}

export function activeBoosts(receipts, now = Date.now()) {
  const active = Object.values(receipts || {}).filter(row => row?.cluster === 'devnet' && row?.status === 'finalized'
    && boostPackage(row.packageId)?.multiplier === row.multiplier
    && Number.isFinite(Date.parse(row.startsAt)) && Date.parse(row.startsAt) <= now
    && Number.isFinite(Date.parse(row.expiresAt)) && Date.parse(row.expiresAt) > now);
  const byMint = {};
  for (const row of active) {
    const item = byMint[row.mint] ||= { mint: row.mint, multiplier: 0, count: 0, golden: false, expiresAt: row.expiresAt, nextExpiry: row.expiresAt, packages: [] };
    item.multiplier += row.multiplier;
    item.count += 1;
    item.packages.push({ packageId: row.packageId, multiplier: row.multiplier, startsAt: row.startsAt, expiresAt: row.expiresAt });
    item.golden = item.multiplier >= 500;
    if (Date.parse(row.expiresAt) > Date.parse(item.expiresAt)) item.expiresAt = row.expiresAt;
    if (Date.parse(row.expiresAt) < Date.parse(item.nextExpiry)) item.nextExpiry = row.expiresAt;
  }
  for (const item of Object.values(byMint)) item.packages.sort((a, b) => b.multiplier - a.multiplier || Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  return byMint;
}
