import {isDeepStrictEqual} from 'node:util';
import {allocateDailyBonusSource,bonusHash,buildDailyBonusSnapshot} from './daily-bonus.mjs';

export function assertBonusSnapshot(snapshot){
  const {hash,...frozen}=snapshot;
  if(hash!==bonusHash(frozen))throw new Error('Saved daily bonus snapshot evidence changed.');
}

// Payment readers must reproduce the recorded eligibility rules and audited
// frozen-ranking append chain. Recomputing every revision as a collection-time
// reranking would hide genuine settlement-time and reconciled payments.
export function verifyBonusSnapshotRevision(record){
  const seen=new Set();
  function verify(snapshot){
    assertBonusSnapshot(snapshot);
    if(seen.has(snapshot.hash)||seen.size>=64)throw new Error('Invalid bonus revision chain.');
    seen.add(snapshot.hash);
    const rebuilt=buildDailyBonusSnapshot({day:snapshot.day,...snapshot.evidence,
      eligibilityBasis:snapshot.eligibilityBasis||'collection-time-v1',now:snapshot.end});
    if(!snapshot.reconciliation){
      if(!isDeepStrictEqual(snapshot,rebuilt))throw new Error('Invalid daily snapshot.');
      return;
    }
    if(snapshot.reconciliation.kind!=='append-only-frozen-rankings-v1')throw new Error('Unknown bonus revision.');
    const matches=(record.revisions||[]).filter(row=>row.snapshot?.hash===snapshot.reconciliation.priorHash);
    if(matches.length!==1)throw new Error('Missing or ambiguous archived bonus revision.');
    verify(matches[0].snapshot);
    if(!isDeepStrictEqual(snapshot,appendDailyBonusResidual(matches[0].snapshot,rebuilt)))
      throw new Error('Audited bonus append does not match its frozen source evidence.');
  }
  verify(record.snapshot);
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
