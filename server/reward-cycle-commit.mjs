import { rewardReviewDelaySeconds } from '../protocol-guard.js';

// Mainnet reward cycles must exist on chain for the guardian review delay
// before they pay. This commits every frozen manifest (status 'prepared',
// no cycle yet) as soon as it is ready, instead of at payout time. Devnet has
// no delay and keeps creating cycles in the distribution pass.
export async function commitReviewedCycles({ store, chain, cluster, now, selected = null, screen = async () => true }) {
  if (!rewardReviewDelaySeconds(cluster)) return { committed: 0 };
  const pending = await store.transaction(state => structuredClone(Object.values(state.schedules || {}).filter(row =>
    row.status === 'prepared' && row.manifest && !row.cycle && now < row.payoutAt
    && (selected === null || selected.has(row.id)))));
  let committed = 0;
  for (const plan of pending) {
    if (!await screen(plan)) continue;
    try {
      const cycle = await chain.ensureCycle(plan);
      await store.transaction(state => {
        const row = state.schedules[plan.id];
        row.cycle = cycle.address;
        row.cycleSignature ||= cycle.signature || null;
        row.reason = null;
      });
      committed += 1;
    } catch (error) {
      await store.transaction(state => {
        state.schedules[plan.id].reason = `Cycle commitment pending: ${String(error.message || error)}`;
      });
    }
  }
  return { committed };
}
