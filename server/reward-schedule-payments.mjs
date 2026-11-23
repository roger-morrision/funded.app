import { rewardPayoutGroups } from './reward-batch.mjs';
import { nativeRecipientFundingPending } from './native-reward-recipient.mjs';
import {payoutIntentHash} from './reward-payout-journal.mjs';
import {completedRewardPayment} from './reward-paid-record.mjs';
import {selectHolderPayoutPage} from './holder-payout-page.mjs';

// A holder page is already bounded at 32 leaves. Commit at most eight outcomes
// together so a normal Mainnet page does not rewrite the entire ledger once
// per recipient. Every successful result still needs its durable proof first.
const HOLDER_COMPLETION_CHUNK=8;
async function recordHolderOutcomes({store,plan,outcomes}){
  return store.transaction(state=>{
    let submitted=0;
    for(const {leaf,result,error} of outcomes){
      const row=state.schedules?.[plan.id];
      if(!row||payoutIntentHash(row,leaf)!==payoutIntentHash(plan,leaf))continue;
      try{
        if(error)throw error;
        if(!result?.finalized||!result.balanceDeltaVerified)throw Error('Payout lacks finalized state and balance-delta evidence.');
        if(result.payoutTransactionVerified&&!(row.payoutAttempts?.[leaf.recipient]?.state==='verified'
          &&row.payoutAttempts[leaf.recipient].signature===result.signature))throw Error('Payout lacks durable attributed proof.');
        const completed=completedRewardPayment(row.payments[leaf.recipient],leaf,result);
        if(completed.changed)row.payments[leaf.recipient]=completed.record;
        submitted+=result.alreadyPaid?0:1;
      }catch(failure){
        if(row.payments?.[leaf.recipient]?.status==='paid')continue;
        row.payments[leaf.recipient]={...(nativeRecipientFundingPending(failure)
          ||{status:'verification-pending',reason:String(failure.message||failure)}),
          amount:leaf.amount,index:leaf.index,checkedAt:new Date().toISOString()};
      }
    }
    return submitted;
  });
}

export async function payRewardSchedule({ store, chain, plan, batch }) {
  let leaves;
  if(plan.kind==='holder')leaves=await selectHolderPayoutPage({store,plan});
  else{
    const saved=await store.transaction(state=>structuredClone(state.schedules[plan.id].payments||{}));
    leaves=plan.manifest.leaves.filter(leaf=>saved[leaf.recipient]?.status!=='paid');
  }
  let submitted = 0,holderOutcomes=[];
  for await (const group of rewardPayoutGroups({ chain, plan, leaves, batch,store })) {
    const outcomes=await group.submit();
    if(plan.kind==='holder'){
      holderOutcomes.push(...outcomes);
      if(holderOutcomes.length>=HOLDER_COMPLETION_CHUNK){submitted+=await recordHolderOutcomes({store,plan,outcomes:holderOutcomes});holderOutcomes=[];}
      continue;
    }
    for (const { leaf, result, error } of outcomes) {
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
  if(holderOutcomes.length)submitted+=await recordHolderOutcomes({store,plan,outcomes:holderOutcomes});
  return submitted;
}
