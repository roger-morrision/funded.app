// Group verified activity projections; never infer delivery from vault funding.
export const rewardDashboardGroups = ['action', 'automatic', 'received', 'waiting'];
export function rewardDashboardGroup(row, wallet) {
  if (!wallet || row?.wallet !== wallet) return null;
  if (row.stage === 'Verified' && row.id?.startsWith('paid:')) return 'received';
  if (row.stage === 'Awaiting approval' && row.ready === true) return 'action';
  if (row.stage === 'Processing') return row.automatic === true ? 'automatic' : 'action';
  return 'waiting';
}
export function rewardDashboardSummary(rows, wallet, { checking = false, missing = [] } = {}) {
  const groups = Object.fromEntries(rewardDashboardGroups.map(key => [key, []]));
  const unique = new Map((rows || []).filter(row => row?.id).map(row => [row.id, row]));
  for (const row of unique.values()) {
    const group = rewardDashboardGroup(row, wallet);
    if (group) groups[group].push(row);
  }
  const partial = missing.some(source => source !== 'buybacks');
  const state = !wallet ? 'disconnected' : checking ? 'checking' : partial ? 'partial' : 'ready';
  return { groups, state, count(key) {
    if (state === 'disconnected') return '—';
    if (state === 'checking') return 'Checking…';
    const count = groups[key].length;
    return partial ? count ? `${count}+` : 'Unavailable' : String(count);
  } };
}
