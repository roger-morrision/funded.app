import assert from 'node:assert/strict';

export const REWARD_PAYOUT_RECOVERY_LIMIT=32;
const work=(state,selected)=>Object.values(state.schedules||{}).filter(plan=>selected===null||selected.has(plan.id)).flatMap(plan=>
  Object.keys(plan.payoutAttempts||{}).length?plan.manifest.leaves
    .filter(leaf=>Object.hasOwn(plan.payoutAttempts,leaf.recipient)).map(leaf=>({plan,leaf,
      key:JSON.stringify([plan.id,leaf.index,leaf.recipient])})):[]);
const order=(a,b)=>a.key<b.key?-1:a.key>b.key?1:0;
function cursor(state){
  const saved=state.rewardPayoutRecoveryCursor;
  if(saved===undefined)return null;
  assert(saved?.version===1&&typeof saved.after==='string'&&saved.after.length<=4096,'Invalid saved payout recovery cursor.');
  const key=JSON.parse(saved.after);
  assert(Array.isArray(key)&&key.length===3&&typeof key[0]==='string'&&Number.isSafeInteger(key[1])&&key[1]>=0
    &&typeof key[2]==='string'&&JSON.stringify(key)===saved.after,'Invalid saved payout recovery cursor key.');
  return saved.after;
}
const tasks=(state,selected)=>{
  const all=work(state,selected).sort(order);
  assert(new Set(all.map(task=>task.key)).size===all.length&&all.every(task=>typeof task.plan.id==='string'
    &&Number.isSafeInteger(task.leaf.index)&&task.leaf.index>=0&&typeof task.leaf.recipient==='string'
    &&task.key.length<=4096),'Invalid or duplicate saved payout recovery task.');
  return all;
};

// Only bounds read-only saved-attempt calls. The cursor is not an attempt,
// payment proof or authorization to replace an uncertain signed transaction.
export async function selectRewardPayoutRecoveries({store,selected=null}){
  const snapshot=await store.read(),initial=tasks(snapshot,selected);
  // Preserve the no-write cached-completion path for a small recovery set.
  if(initial.length<=REWARD_PAYOUT_RECOVERY_LIMIT)return initial;
  return store.transaction(state=>{
    const all=tasks(state,selected),after=cursor(state);
    if(all.length<=REWARD_PAYOUT_RECOVERY_LIMIT)return structuredClone(all);
    let start=after===null?0:all.findIndex(task=>task.key>after);if(start<0)start=0;
    const picked=Array.from({length:REWARD_PAYOUT_RECOVERY_LIMIT},(_,i)=>all[(start+i)%all.length]);
    state.rewardPayoutRecoveryCursor={version:1,after:picked.at(-1).key};
    return structuredClone(picked);
  });
}
