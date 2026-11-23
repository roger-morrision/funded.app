import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {verifyRewardProof} from '../reward-merkle.js';

// Bounded scheduling only. Admission remains 1,000; 1,001 is the isolated
// integration-test bound, not permission to create or fund a larger cohort.
export const HOLDER_PAYOUT_PAGE_LIMITS=Object.freeze({leaves:32,integrationCohort:1001});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function metadataIdentity(plan){
  const m=plan?.manifest;
  assert(plan?.kind==='holder'&&typeof plan.id==='string'&&m?.version===1
    &&Array.isArray(m.leaves)&&m.leaves.length>0&&m.leaves.length<=HOLDER_PAYOUT_PAGE_LIMITS.integrationCohort,
    'Bounded immutable holder manifest required.');
  return hash([plan.id,plan.cluster,plan.genesisHash,plan.mint,plan.kind,plan.cycle,plan.originalAuthority,
    plan.cutoffAt,plan.payoutAt,m.cycleId,m.asset,m.root,m.totalAmount,m.leaves.length]);
}
function identity(plan){
  const metadata=metadataIdentity(plan),m=plan.manifest;
  const seen=new Set();let total=0n;
  for(const [index,leaf] of m.leaves.entries()){
    assert(leaf.index===index&&new PublicKey(leaf.recipient).toBase58()===leaf.recipient&&!seen.has(leaf.recipient)
      &&typeof leaf.amount==='string'&&/^[1-9]\d*$/.test(leaf.amount)&&BigInt(leaf.amount)<=0xffffffffffffffffn
      &&Array.isArray(leaf.proof)&&leaf.proof.length<=32&&verifyRewardProof({...leaf,cycleId:m.cycleId,asset:m.asset,root:m.root}),
      'Holder page cannot renumber or change a global entitlement.');
    seen.add(leaf.recipient);total+=BigInt(leaf.amount);
  }
  assert(String(total)===m.totalAmount&&total<=0xffffffffffffffffn&&plan.asset===m.asset,'Holder manifest accounting differs.');
  return {metadata,leaves:hash(m.leaves)};
}

// This cursor is a fair work hint, never a payment/receipt/finality fact. Moving
// it before work means a crash may defer a leaf until the next bounded round;
// original leaves and saved signed attempts remain the only entitlements.
export async function selectHolderPayoutPage({store,plan,limit=HOLDER_PAYOUT_PAGE_LIMITS.leaves}){
  assert(Number.isSafeInteger(limit)&&limit>0&&limit<=HOLDER_PAYOUT_PAGE_LIMITS.leaves,'Invalid holder payout work bound.');
  // Validate every global proof before entering the exclusive ledger lock.
  // A digest of the exact validated leaves then binds the locked row without
  // repeating public-key and Merkle verification while other writers wait.
  const expected=identity(plan);
  return store.transaction(state=>{
    const row=state.schedules?.[plan.id];assert(row&&metadataIdentity(row)===expected.metadata
      &&hash(row.manifest.leaves)===expected.leaves,'Holder page schedule changed.');
    const count=row.manifest.leaves.length,prior=row.holderPayoutCursor;
    if(prior!==undefined)assert(prior?.version===1&&prior.identity===expected.metadata&&Number.isSafeInteger(prior.nextIndex)
      &&prior.nextIndex>=0&&prior.nextIndex<count,'Saved holder payout cursor differs.');
    const start=prior?.nextIndex||0,selected=[];let next=start;
    for(let visited=0;visited<count&&selected.length<limit;visited++){
      const index=(start+visited)%count,leaf=row.manifest.leaves[index];next=(index+1)%count;
      if(row.payments?.[leaf.recipient]?.status!=='paid')selected.push(leaf);
    }
    if(selected.length)row.holderPayoutCursor={version:1,identity:expected.metadata,nextIndex:next};
    return structuredClone(selected);
  });
}
