export function rewardView(obligation,claim,proofs=[]) {
  const status=claim?.status||obligation.status||'unprepared';
  const receipt=proofs.find(p=>p.claimId===obligation.id&&p.signature===claim?.payoutSignature&&p.to===claim?.publicKey&&String(p.amountLamports)===String(obligation.amountLamports)&&p.source==='mint-router-settle-mint');
  const paid=status==='paid'&&Boolean(receipt);
  const pending=['paid','executing','verification-pending'].includes(status);
  const lamports=Number(obligation.amountLamports);
  const amountSol=Number.isSafeInteger(lamports)&&lamports>=0?lamports/1e9:null;
  return {id:obligation.id,mint:obligation.mint,amountSol,status,group:paid?'Paid':pending?'Pending verification':'Available to prepare',receiptVerified:paid,payoutSignature:paid?receipt.signature:null,canPrepare:!pending,explanation:paid?'Confirmed recipient balance delta.':pending?'Do not submit another payout. The existing attempt needs receipt verification.':'Verify your X account and bind the intended wallet. Network/service readiness still applies.'};
}
export function renewClaimChallenge(claim,nonce,now=Date.now()) {
  if(!claim.expiresAt||Date.parse(claim.expiresAt)>=now||['paid','executing','verification-pending'].includes(claim.status))return claim;
  return {...claim,nonce,expiresAt:new Date(now+14*24*60*60*1000).toISOString(),renewedAt:new Date(now).toISOString()};
}
export function confirmedClaimResult(claims, claimId, signature) {
  return Array.isArray(claims) ? claims.find(claim=>claim.id===claimId&&claim.group==='Paid'&&claim.receiptVerified===true&&claim.payoutSignature===signature)||null : null;
}
