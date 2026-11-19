// A claim uses the wallet's existing sign-in. The server derives the destination
// and amount from the finalized entitlement and pays through its signer.
export async function claimReferralReward({session,claim,ensureSession,assertCurrent,request}) {
  assertCurrent(session);
  if(!await ensureSession(session))throw new Error('Sign in with your wallet again to claim your reward.');
  assertCurrent(session);
  const path=`/api/tokens/${encodeURIComponent(claim.mint)}/v3-referral-payout/${encodeURIComponent(claim.collectionSignature)}/${claim.level}`;
  const result=await request(path,{method:'POST',body:{}});
  assertCurrent(session);
  const proof=result.data;
  if(!proof||proof.recipient!==session.address||proof.mint!==claim.mint
    ||proof.collectionSignature!==claim.collectionSignature||proof.level!==claim.level
    ||proof.amount!==String(claim.amountLamports))
    throw new Error(proof?.error||'Referral claim verification is unavailable.');
  if(proof.status!=='finalized'||!proof.signature||proof.balanceDeltaVerified!==true)
    throw new Error(proof.error||'Payment needs verification. Check the existing claim before retrying.');
  return proof;
}
