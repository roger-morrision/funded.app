import { rewardPayoutGroups } from './reward-batch.mjs';
import { nativeRecipientFundingPending } from './native-reward-recipient.mjs';

export async function payDailyBonusLeaves({ chain, plan, readLedger, rewardStore, day, source, snapshot, cluster, now }) {
  const saved = (await readLedger()).dailyBonusSnapshots[day].payouts[source.collectionSignature].payments;
  const leaves = plan.manifest.leaves.filter(leaf => !saved[leaf.recipient]?.finalized || !saved[leaf.recipient]?.balanceDeltaVerified);
  for await (const group of rewardPayoutGroups({ chain, plan, leaves })) {
    const current = (await readLedger()).dailyBonusSnapshots[day];
    if (current.status !== 'snapshotted' || current.snapshot.hash !== snapshot.hash)
      throw new Error('Daily bonus snapshot changed or was paused before payment.');
    let failure;
    for (const { leaf, result:payment, error } of await group.submit()) {
      if (error) {
        const pending = nativeRecipientFundingPending(error);
        if (!pending) { failure ||= error; continue; }
        await rewardStore.transaction(state => {
          const payments = state.dailyBonusSnapshots[day].payouts[source.collectionSignature].payments;
          if (!payments[leaf.recipient]?.finalized) payments[leaf.recipient] = {
            ...pending, amount:leaf.amount, checkedAt:new Date(now() * 1000).toISOString() };
        });
      } else if (!payment?.finalized || !payment.balanceDeltaVerified) {
        failure ||= new Error('Daily bonus payment lacks finalized account and balance evidence.');
      } else await rewardStore.transaction(state => {
        state.dailyBonusSnapshots[day].payouts[source.collectionSignature].payments[leaf.recipient] = {
          ...payment, cluster, amount:leaf.amount, paidAt:new Date(now() * 1000).toISOString() };
      });
    }
    if (failure) throw failure;
  }
}
