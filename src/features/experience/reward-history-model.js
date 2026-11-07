import { newestFirst, solText } from './financial-model.js';
import { rewardDashboardGroup } from './reward-dashboard-model.js';

export function rewardHistoryRows(rows, wallet, { scope = 'personal', status = 'all', query = '', from = '', to = '', sort = 'newest' } = {}) {
  if (from && to && from > to) return [];
  const selected = rows.filter(row => {
    if (scope === 'personal' ? !wallet || row.wallet !== wallet : Boolean(row.wallet)) return false;
    if (status !== 'all' && (status.startsWith('dashboard-') ? rewardDashboardGroup(row, wallet) !== status.slice(10) : row.stage !== status)) return false;
    const search=query.trim();
    if (search && !String(row.title||'').toLowerCase().includes(search.toLowerCase())
      && ![row.mint,row.signature,row.wallet].some(value=>typeof value==='string'&&value.includes(search))) return false;
    const time = Date.parse(row.at || '');
    if ((from || to) && !Number.isFinite(time)) return false;
    if (from && time < Date.parse(`${from}T00:00:00Z`)) return false;
    if (to && time >= Date.parse(`${to}T00:00:00Z`) + 86400000) return false;
    return true;
  });
  return sort === 'oldest' ? newestFirst(selected).reverse() : newestFirst(selected);
}

export function receivedTotal(rows, wallet, range = {}) {
  const receipts = rewardHistoryRows(rows, wallet, { ...range, status: 'dashboard-received', scope: 'personal' });
  const unique = new Map(receipts.map(row => [row.id, row]));
  let lamports = 0n, unknown = 0;
  for (const row of unique.values()) {
    if (/^(0|[1-9]\d*)$/.test(String(row.amountLamports))) lamports += BigInt(row.amountLamports);
    else unknown++;
  }
  return { amount: solText(lamports.toString()), count: unique.size, unknown };
}

// Fetch a small batch at a time so a large portfolio cannot flood the API.
export async function readCreatorHistory(owned, read, isCurrent = () => true, onProgress = () => {}) {
  const mints = [...new Set(owned.map(row => row.mint).filter(mint => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)))];
  const results = [];
  for (let offset = 0; offset < mints.length && isCurrent(); offset += 4) {
    const batch = await Promise.all(mints.slice(offset, offset + 4).map(mint => read(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`)));
    if (!isCurrent()) return null;
    results.push(...batch); onProgress(results.length, mints.length);
  }
  return isCurrent() ? results : null;
}
