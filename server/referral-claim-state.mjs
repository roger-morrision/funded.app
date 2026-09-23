import {validClaimId} from './claim-state.mjs';

export function scopedReferralClaimState(state,id) {
  validClaimId(id);
  const result={referralClaims:{},payouts:{}};
  if(state.referralClaims?.[id])result.referralClaims[id]=state.referralClaims[id];
  for(const [key,row] of Object.entries(state.payouts||{}))if(row.claimId===id||key===`referral:${id}`)result.payouts[key]=row;
  return structuredClone(result);
}
export async function mutateReferralClaimState(state,id,mutator) {
  validClaimId(id);
  const before=structuredClone(state),output=await mutator(state);
  const prior=before.referralClaims[id],claim=state.referralClaims?.[id],canonical=`referral:${id}`;
  if(Object.keys(state).sort().join()!=='payouts,referralClaims'||!state.referralClaims||!state.payouts
    ||Object.keys(state.referralClaims).some(key=>key!==id))throw new Error('Referral transitions may only change this claim and its payout.');
  if(!prior||!claim||claim.id!==id)throw new Error('Referral transitions cannot create, delete or rename claims.');
  if(['id','settlementSignature','level','recipientWallet','amount','asset','nonce','expiresAt','createdAt'].some(key=>claim[key]!==prior[key]))throw new Error('Original referral entitlement cannot change.');
  if(prior.publicKey&&claim.publicKey!==prior.publicKey)throw new Error('Original referral wallet cannot change.');
  if(claim.publicKey&&claim.publicKey!==claim.recipientWallet)throw new Error('Referral destination must match the entitled wallet.');
  if(['wallet-verified','executing','paid'].includes(claim.status)&&!claim.publicKey)throw new Error('Referral wallet verification is required.');
  const transitions={
    'awaiting-wallet-signature':['awaiting-wallet-signature','wallet-verified'],
    'wallet-verified':['wallet-verified','executing'],
    executing:['executing','paid','verification-pending'],
    'verification-pending':['verification-pending'],failed:['failed'],paid:['paid'],
  };
  if(!transitions[prior.status]?.includes(claim.status))throw new Error('Referral transition requires reconciliation.');
  if(prior.status==='paid'&&JSON.stringify(prior)!==JSON.stringify(claim))throw new Error('Paid referral claims are immutable.');
  for(const [key,row] of Object.entries(before.payouts))if(JSON.stringify(state.payouts[key])!==JSON.stringify(row))throw new Error('Recorded referral payouts are immutable.');
  for(const [key,row] of Object.entries(state.payouts))if(!Object.hasOwn(before.payouts,key)){
    if(key!==canonical||row.id!==canonical||row.claimId!==id||row.status!=='paid'||claim.status!=='paid'
      ||claim.payoutId!==canonical||claim.payoutSignature!==row.signature||typeof row.signature!=='string'||!row.signature
      ||row.to!==claim.recipientWallet||!Number.isFinite(Number(row.amountSol))||Number(row.amountSol)<=0
      ||Number(row.amountSol)!==Number(claim.amount)||claim.asset!=='SOL'||row.paidAt!==claim.paidAt)throw new Error('Referral payout must exactly match its paid claim.');
  }
  if(prior.status!=='paid'&&claim.status==='paid'&&(!state.payouts[canonical]||Object.keys(before.payouts).length))throw new Error('Paid referral status needs a new atomic payout and no previous payout.');
  if(claim.status!=='paid'&&(claim.payoutId!==prior.payoutId||claim.payoutSignature!==prior.payoutSignature))throw new Error('Unpaid referral claims cannot acquire payout receipts.');
  return output;
}

// Called inside the ledger transaction, after signature verification outside it.
export function verifyReferralClaim(current,observed,publicKey,now=Date.now()) {
  if(!current||['id','nonce','recipientWallet','amount','asset','expiresAt'].some(key=>current[key]!==observed[key]))throw new Error('Referral claim changed. Refresh before signing again.');
  if(current.status==='paid'||current.status==='wallet-verified')return current;
  if(['executing','verification-pending','failed'].includes(current.status))throw new Error('The previous payout needs reconciliation before another attempt.');
  if(current.expiresAt&&Date.parse(current.expiresAt)<now)throw new Error('Referral claim has expired.');
  if(current.recipientWallet!==publicKey)throw new Error('Referral recipient wallet does not match.');
  return {...current,publicKey,status:'wallet-verified',verifiedAt:new Date(now).toISOString()};
}
export function pendingReferralClaim(current,error,now=Date.now()) {
  if(current?.status!=='executing')return current;
  // A send/confirmation error does not prove that a direct SOL transfer failed.
  return {...current,status:'verification-pending',failureReason:String(error.message||error),lastAttemptAt:new Date(now).toISOString()};
}
