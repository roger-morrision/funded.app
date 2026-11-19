export async function claimCreatorFees({session,mint,collectionSignature,amountLamports,ensureSession,assertCurrent,request}) {
  assertCurrent(session);
  if(!await ensureSession(session))throw new Error('Sign in with your creator wallet again to claim your fees.');
  assertCurrent(session);
  const result=await request(`/api/tokens/${encodeURIComponent(mint)}/v3-creator-wallet-payout/${encodeURIComponent(collectionSignature)}`,{method:'POST',body:{}});
  assertCurrent(session);
  const proof=result.data;
  if(!proof||proof.mint!==mint||proof.collectionSignature!==collectionSignature
    ||proof.recipient!==session.address||proof.amount!==String(amountLamports))
    throw new Error(proof?.error||'Creator fee claim verification is unavailable.');
  if(proof.status!=='finalized'||!proof.signature||proof.balanceDeltaVerified!==true)
    throw new Error(proof.error||'Payment needs verification. Check the existing claim before retrying.');
  return proof;
}
