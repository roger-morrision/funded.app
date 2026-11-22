import assert from 'node:assert/strict';

export const REWARD_PAYOUT_RECOVERY_LIMIT=32;
const work=(state,selected)=>Object.values(state.schedules||{}).filter(plan=>selected===null||selected.has(plan.id)).flatMap(plan=>
  Object.keys(plan.payoutAttempts||{}).length?plan.manifest.leaves
    .filter(leaf=>Object.hasOwn(plan.payoutAttempts,leaf.recipient)).map(leaf=>({plan,leaf,
      key:JSON.stringify([plan.id,leaf.index,leaf.recipient])})):[]);
const order=(a,b)=>a.key<b.key?-1:a.key>b.key?1:0;
function cursorKey(saved,planId=null){
  if(saved===undefined)return null;
  assert(saved?.version===1&&typeof saved.after==='string'&&saved.after.length<=4096,'Invalid saved payout recovery cursor.');
  const key=JSON.parse(saved.after);
  assert(Array.isArray(key)&&key.length===3&&typeof key[0]==='string'&&Number.isSafeInteger(key[1])&&key[1]>=0
    &&typeof key[2]==='string'&&JSON.stringify(key)===saved.after&&(planId===null||key[0]===planId),
    'Invalid saved payout recovery cursor key.');
  return saved.after;
}
const circular=(all,after,count)=>{
  let start=after===null?0:all.findIndex(task=>task.key>after);if(start<0)start=0;
  return Array.from({length:count},(_,i)=>all[(start+i)%all.length]);
};
function filteredPage(state,all){
  let sequence=state.rewardPayoutFilteredSequence??0;
  assert(Number.isSafeInteger(sequence)&&sequence>=0,'Invalid filtered payout recovery sequence.');
  const groups=new Map();
  for(const task of all){
    if(!groups.has(task.plan.id)){
      const saved=task.plan.filteredPayoutRecoveryCursor,after=cursorKey(saved,task.plan.id),served=saved===undefined?0:saved.servedAt;
      assert(Number.isSafeInteger(served)&&(saved===undefined?served===0:served>0)&&served<=sequence,'Invalid filtered schedule recovery progress.');
      groups.set(task.plan.id,{plan:task.plan,tasks:[],after,served});
    }
    groups.get(task.plan.id).tasks.push(task);
  }
  // Constant metadata per existing schedule, not an unbounded map of subsets.
  // Serving A alone cannot rewind either full-queue progress or B's leaf cursor.
  const ordered=[...groups.values()].sort((a,b)=>a.served-b.served||(a.plan.id<b.plan.id?-1:a.plan.id>b.plan.id?1:0)),picked=[];
  for(const group of ordered){
    const page=circular(group.tasks,group.after,Math.min(REWARD_PAYOUT_RECOVERY_LIMIT-picked.length,group.tasks.length));
    assert(Number.isSafeInteger(sequence+1),'Filtered payout recovery sequence exhausted.');
    group.plan.filteredPayoutRecoveryCursor={version:1,after:page.at(-1).key,servedAt:++sequence};
    picked.push(...page);if(picked.length===REWARD_PAYOUT_RECOVERY_LIMIT)break;
  }
  state.rewardPayoutFilteredSequence=sequence;return picked;
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
    const all=tasks(state,selected);
    if(all.length<=REWARD_PAYOUT_RECOVERY_LIMIT)return structuredClone(all);
    if(selected!==null)return structuredClone(filteredPage(state,all));
    const picked=circular(all,cursorKey(state.rewardPayoutRecoveryCursor),REWARD_PAYOUT_RECOVERY_LIMIT);
    state.rewardPayoutRecoveryCursor={version:1,after:picked.at(-1).key};
    return structuredClone(picked);
  });
}
