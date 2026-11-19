// X ownership is checked by the server; wallet ownership uses the existing sign-in.
export async function claimXReward({session,mint,collectionSignature,amountLamports,ensureSession,assertCurrent,request}) {
  assertCurrent(session);
  if(!await ensureSession(session))throw new Error('Sign in with your receiving wallet to claim this reward.');
  assertCurrent(session);
  const result=await request(`/api/tokens/${encodeURIComponent(mint)}/v3-x-claim/${encodeURIComponent(collectionSignature)}/execute`,{method:'POST',body:{}});
  assertCurrent(session);
  const proof=result.data;
  if(!proof||proof.mint!==mint||proof.collectionSignature!==collectionSignature
    ||proof.wallet!==session.address||proof.amountLamports!==String(amountLamports))
    throw new Error(proof?.error||'X reward claim verification is unavailable.');
  if(proof.status!=='paid'||!proof.payment?.signature||proof.payment.finalized!==true
    ||proof.payment.balanceDeltaVerified!==true||proof.payment.amount!==String(amountLamports))
    throw new Error(proof.error||'Payment needs verification. Check the existing claim before retrying.');
  return proof;
}
