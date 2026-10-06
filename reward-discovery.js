export function automaticXClaimState(obligation, claim, rewards = {}) {
  if (!claim?.publicKey || claim.xUserId !== obligation.xUserId || claim.obligationId !== obligation.id
    || claim.xAttestation?.subject !== obligation.xUserId) return null;
  const request = rewards.fundingRequests?.[`${obligation.claimSignature}:x`];
  if (!request || request.kind !== 'x' || request.asset !== 'SOL' || request.mint !== obligation.mint
    || request.sourceSignature !== obligation.claimSignature || request.obligationId !== obligation.id
    || request.recipient !== claim.publicKey || String(request.amount) !== String(obligation.amountLamports)
    || !['pending', 'funding', 'funded', 'verification-pending'].includes(request.status)) return null;
  const schedule = rewards.schedules?.[request.scheduleId];
  const leaf = schedule?.manifest?.leaves?.find(row => row.recipient === claim.publicKey);
  const payment = schedule?.payments?.[claim.publicKey];
  const paid = request.status === 'funded' && request.balanceDeltaVerified === true
    && schedule?.sourceId === request.id && schedule.mint === obligation.mint
    && schedule.kind === 'x' && schedule.asset === 'SOL'
    && schedule.fundingSignature === request.fundingSignature && schedule.balanceDeltaVerified === true
    && String(schedule.manifest?.totalAmount) === String(obligation.amountLamports)
    && String(leaf?.amount) === String(obligation.amountLamports)
    && payment?.status === 'paid' && payment.finalized === true && payment.balanceDeltaVerified === true
    && String(payment.amount) === String(obligation.amountLamports)
    && typeof payment.signature === 'string' && payment.signature.length > 0;
  return { status:request.status, recipient:claim.publicKey, payoutSignature:paid ? payment.signature : null, paid };
}

export function rewardView(obligation,claim,proofs=[],automatic=null) {
  const status=claim?.status||obligation.status||'unprepared';
  const receipt=proofs.find(p=>p.claimId===obligation.id&&p.signature===claim?.payoutSignature&&p.to===claim?.publicKey&&String(p.amountLamports)===String(obligation.amountLamports)&&p.source==='mint-router-settle-mint');
  const paid=status==='paid'&&Boolean(receipt)||automatic?.paid===true;
  const pending=Boolean(automatic)||['paid','executing','verification-pending'].includes(status);
  const lamports=Number(obligation.amountLamports);
  const amountSol=Number.isSafeInteger(lamports)&&lamports>=0?lamports/1e9:null;
  return {id:obligation.id,mint:obligation.mint,amountSol,status:automatic?.paid?'paid':automatic?`automatic-${automatic.status}`:status,group:paid?'Paid':pending?'Pending verification':'Available to prepare',receiptVerified:paid,payoutSignature:paid?(automatic?.payoutSignature||receipt?.signature):null,payoutWallet:paid?(automatic?.recipient||claim?.publicKey):null,canPrepare:!pending,explanation:paid?'Confirmed recipient balance delta.':automatic?'Automatic delivery is in progress. No further claim action is needed.':pending?'Do not submit another payout. The existing attempt needs receipt verification.':'Verify your X account and bind the intended wallet. Network/service readiness still applies.'};
}
export function renewClaimChallenge(claim,nonce,now=Date.now()) {
  if(!claim.expiresAt||Date.parse(claim.expiresAt)>=now||['paid','executing','verification-pending'].includes(claim.status))return claim;
  return {...claim,nonce,expiresAt:new Date(now+14*24*60*60*1000).toISOString(),renewedAt:new Date(now).toISOString()};
}
export function confirmedClaimResult(claims, claimId, signature) {
  return Array.isArray(claims) ? claims.find(claim=>claim.id===claimId&&claim.group==='Paid'&&claim.receiptVerified===true&&claim.payoutSignature===signature)||null : null;
}
