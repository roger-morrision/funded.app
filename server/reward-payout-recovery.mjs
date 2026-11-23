import {payoutIntentHash} from './reward-payout-journal.mjs';
import {completedRewardPayment} from './reward-paid-record.mjs';
import {selectRewardPayoutRecoveries} from './reward-recovery-page.mjs';
import {REWARD_LEDGER_UNCHANGED} from './automatic-reward-store.mjs';

// Read-only recovery is selected independently of today's due/blocked/paid state.
// It cannot create an attempt even if the persisted marker disappears mid-read.
export async function recoverSavedRewardPayouts({store,chain,selected=null}){
  if(typeof chain.submitLeaf!=='function')return 0;
  const tasks=await selectRewardPayoutRecoveries({store,selected});
  let recovered=0;const failures=[];
  for(const {plan,leaf} of tasks){
    const original=plan.payoutAttempts[leaf.recipient],intent=payoutIntentHash(plan,leaf);
    try{
      const result=await chain.submitLeaf(plan,leaf,{store,recoveryOnly:true});
      if(!result?.payoutTransactionVerified)throw Error('Payout needs exact saved-attempt reconciliation.');
      if(!completedRewardPayment(plan.payments?.[leaf.recipient],leaf,result).changed)continue;
      await store.transaction(state=>{
        const row=state.schedules?.[plan.id],saved=row?.payoutAttempts?.[leaf.recipient];
        if(!row||payoutIntentHash(row,leaf)!==intent||saved?.state!=='verified'||saved.signature!==result.signature)
          throw Error('Payout schedule changed before attributed completion.');
        row.payments||={};const completed=completedRewardPayment(row.payments[leaf.recipient],leaf,result);
        if(completed.changed)row.payments[leaf.recipient]=completed.record;
      });recovered++;
    }catch(error){
      failures.push({planId:plan.id,leaf:structuredClone(leaf),original:structuredClone(original),intent,
        message:String(error.message||error).slice(0,180)});
    }
  }
  // All selected attempts are already durably saved. Publish diagnostic errors
  // and restore any disappeared marker in one locked transaction per page,
  // rather than reserializing the whole ledger for every unknown result.
  if(failures.length)await store.transaction(state=>{
    let changed=false;
    for(const {planId,leaf,original,intent,message} of failures){
      const row=state.schedules?.[planId];if(!row||payoutIntentHash(row,leaf)!==intent)continue;
      if(!Object.hasOwn(row.payoutAttempts||{},leaf.recipient)){
        row.payoutAttempts||={};row.payoutAttempts[leaf.recipient]=original;changed=true;
      }
      if(row.payoutRecoveryError!==message){row.payoutRecoveryError=message;changed=true;}
    }
    if(!changed)return REWARD_LEDGER_UNCHANGED;
  });
  return recovered;
}
