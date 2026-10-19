import {isDeepStrictEqual} from 'node:util';
import {allocateDailyBonusSource,bonusHash} from './daily-bonus.mjs';

export function assertBonusSnapshot(snapshot){
  const {hash,...frozen}=snapshot;
  if(hash!==bonusHash(frozen))throw new Error('Saved daily bonus snapshot evidence changed.');
}

// An assignment can keep its original hash after an audited append. Both
// that archived snapshot and its exact source manifest must still be intact.
export function bonusAssignmentMatches(record,source,hash){
  for(const snapshot of [record.snapshot,...(record.revisions||[]).map(row=>row.snapshot)]){
    assertBonusSnapshot(snapshot);
    if(snapshot.hash===hash&&isDeepStrictEqual(snapshot.sources.find(row=>row.collectionSignature===source.collectionSignature),source))return true;
  }
  return false;
}

// A reserved/paid snapshot is never reranked. Late, additive evidence can
// contribute unassigned sources to its original winners. Existing manifests,
// scores, retained balances and paid receipts remain byte-for-byte intact.
export function appendDailyBonusResidual(prior,next){
  assertBonusSnapshot(prior);assertBonusSnapshot(next);
  if(prior.day!==next.day||prior.start!==next.start||prior.end!==next.end
    ||!isDeepStrictEqual(prior.policy,next.policy))throw new Error('Bonus reconciliation cannot change a frozen window or policy.');
  for(const [kind,key] of [['collections',row=>row.signature],['trades',row=>`${row.signature}:${row.logIndex}:${row.mint}`]]){
    const current=new Map(next.evidence[kind].map(row=>[key(row),row]));
    if(prior.evidence[kind].some(row=>!isDeepStrictEqual(current.get(key(row)),row)))
      throw new Error('Reserved bonus evidence cannot be removed or modified; only additive evidence can be reconciled.');
  }
  if(isDeepStrictEqual(prior.evidence,next.evidence))throw new Error('No additive evidence exists; the prepared or paid daily bonus remains unchanged.');
  const rankings=structuredClone(prior.rankings),known=new Set(prior.sources.map(row=>row.collectionSignature));
  const evidenceById=new Map(next.evidence.collections.map(row=>[row.signature,row]));
  const added=next.sources.filter(source=>!known.has(source.collectionSignature))
    .map(source=>allocateDailyBonusSource(evidenceById.get(source.collectionSignature),rankings));
  const {hash:priorHash,...frozen}=prior;
  const snapshot={...frozen,rankings,sources:[...prior.sources,...added],evidence:next.evidence,
    reconciliation:{kind:'append-only-frozen-rankings-v1',priorHash,addedSourceSignatures:added.map(row=>row.collectionSignature)}};
  return {...snapshot,hash:bonusHash(snapshot)};
}
