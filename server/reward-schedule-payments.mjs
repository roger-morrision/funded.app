import { rewardPayoutGroups } from './reward-batch.mjs';
import { nativeRecipientFundingPending } from './native-reward-recipient.mjs';
import {payoutIntentHash} from './reward-payout-journal.mjs';
import {completedRewardPayment} from './reward-paid-record.mjs';
import {selectHolderPayoutPage} from './holder-payout-page.mjs';

export async function payRewardSchedule({ store, chain, plan, batch }) {
  let leaves;
  if(plan.kind==='holder')leaves=await selectHolderPayoutPage({store,plan});
  else{
    const saved=await store.transaction(state=>structuredClone(state.schedules[plan.id].payments||{}));
    leaves=plan.manifest.leaves.filter(leaf=>saved[leaf.recipient]?.status!=='paid');
  }
  let submitted = 0;
  for await (const group of rewardPayoutGroups({ chain, plan, leaves, batch,store })) {
    for (const { leaf, result, error } of await group.submit()) {
      try {
        if (error) throw error;
        if (!result?.finalized || !result.balanceDeltaVerified) throw new Error('Payout lacks finalized state and balance-delta evidence.');
        await store.transaction(state => {
          const row=state.schedules?.[plan.id];
          if(!row||payoutIntentHash(row,leaf)!==payoutIntentHash(plan,leaf))throw Error('Payout schedule changed before completion.');
          if(result.payoutTransactionVerified&&!(row.payoutAttempts?.[leaf.recipient]?.state==='verified'
            &&row.payoutAttempts[leaf.recipient].signature===result.signature))throw Error('Payout lacks durable attributed proof.');
          const completed=completedRewardPayment(row.payments[leaf.recipient],leaf,result);
          if(completed.changed)row.payments[leaf.recipient]=completed.record; });
        submitted += result.alreadyPaid ? 0 : 1;
      } catch (failure) {
        await store.transaction(state => {
          const row = state.schedules?.[plan.id];
          if(!row||payoutIntentHash(row,leaf)!==payoutIntentHash(plan,leaf))return;
          if (row.payments[leaf.recipient]?.status === 'paid') return;
          row.payments[leaf.recipient] = { ...(nativeRecipientFundingPending(failure)
            || { status:'verification-pending', reason:String(failure.message || failure) }),
          amount:leaf.amount, index:leaf.index, checkedAt:new Date().toISOString() };
        });
      }
    }
  }
  return submitted;
}
