export function validClaimId(id) {
  if(typeof id!=='string'||!/^[A-Za-z0-9:_-]{1,256}$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw new Error('Invalid claim ID.');
}
export function scopedClaimState(state,id) {
  validClaimId(id);
  const result={claims:{},obligations:{},collections:{},launches:{},payouts:{}};
  const claim=state.claims?.[id];if(claim)result.claims[id]=claim;
  const obligationId=claim?.obligationId||id,obligation=state.obligations?.[obligationId];
  if(obligation){result.obligations[obligationId]=obligation;
    if(state.collections?.[obligation.claimSignature])result.collections[obligation.claimSignature]=state.collections[obligation.claimSignature];
    if(state.launches?.[obligation.mint])result.launches[obligation.mint]=state.launches[obligation.mint];}
  for(const [key,row] of Object.entries(state.payouts||{}))if(row.claimId===id)result.payouts[key]=row;
  return structuredClone(result);
}
export async function mutateClaimState(state,id,mutator) {
  const before=structuredClone(state),output=await mutator(state),payoutKey=`x:${id}`;
  const immutable=s=>JSON.stringify({obligations:s.obligations,collections:s.collections,launches:s.launches,
    payouts:Object.fromEntries(Object.entries(s.payouts||{}).filter(([key])=>key!==payoutKey))});
  if(Object.keys(state).sort().join()!==Object.keys(before).sort().join()||immutable(state)!==immutable(before)
    || !state.claims || Object.keys(state.claims).some(key=>key!==id)||!state.payouts)throw new Error('Claim writes may only change this claim and its canonical payout.');
  const prior=before.claims[id],claim=state.claims[id],payout=state.payouts[payoutKey];
  if(prior&&!claim)throw new Error('Claims cannot be deleted by a claim transition.');
  if(claim&&claim.id!==id)throw new Error('Claim identity cannot change.');
  if(prior&&['id','xUserId','obligationId','recipient'].some(key=>prior[key]!==claim[key]))throw new Error('Original claim entitlement cannot change.');
  if(prior?.publicKey&&prior.publicKey!==claim.publicKey)throw new Error('Original destination wallet cannot change.');
  if(prior?.status==='paid'&&JSON.stringify(prior)!==JSON.stringify(claim))throw new Error('Paid claims are immutable.');
  if(payout&&(payout.id!==payoutKey||payout.claimId!==id))throw new Error('Payout does not belong to this claim.');
  if(payout&&!before.payouts[payoutKey]&&claim?.status!=='paid')throw new Error('Payout and paid status must commit together.');
  if(claim?.status==='paid'&&prior?.status!=='paid'&&!payout)throw new Error('Paid status requires its canonical payout record.');
  if(before.payouts[payoutKey]&&JSON.stringify(before.payouts[payoutKey])!==JSON.stringify(payout))throw new Error('Recorded payouts are immutable.');
  return output;
}
export function assertObservedClaim(current,observed) {
  if(!current||['id','nonce','xUserId','obligationId','recipient','expiresAt'].some(key=>current[key]!==observed[key]))throw new Error('Claim changed. Refresh it before signing again.');
  if(current.expiresAt&&Date.parse(current.expiresAt)<Date.now())throw new Error('Claim has expired.');
}
