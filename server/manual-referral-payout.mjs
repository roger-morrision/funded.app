import {randomBytes} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';

export function referralPayoutStatement(row){
  return `funded.vip manual referral claim\nNetwork: devnet\nMint: ${row.mint}\nCollection: ${row.collectionSignature}\nLevel: ${row.level}\nRecipient: ${row.recipient}\nAmount: ${row.amount} lamports\nNonce: ${row.nonce}\nExpires: ${row.expiresAt}`;
}
export async function prepareManualReferralPayout(store,intent,now=Date.now()){
  const key=`${intent.collectionSignature}:${intent.level}`;
  return store.update(state=>{
    const rows=state.manualReferralPayoutClaims||={},prior=rows[key];
    if(prior&&['mint','collectionSignature','level','recipient','amount'].some(k=>prior[k]!==intent[k]))
      throw new Error('The referral claim differs from its immutable entitlement.');
    const row=prior&&Date.parse(prior.expiresAt)>now?prior:{...intent,nonce:randomBytes(24).toString('hex'),expiresAt:new Date(now+5*60_000).toISOString()};
    rows[key]=row;return {...row,statement:referralPayoutStatement(row)};
  });
}
export function verifyManualReferralPayout(state,intent,input,now=Date.now()){
  const row=state.manualReferralPayoutClaims?.[`${intent.collectionSignature}:${intent.level}`];
  if(!row||['mint','collectionSignature','level','recipient','amount'].some(k=>row[k]!==intent[k])
    ||input.claimNonce!==row.nonce||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=now)
    throw new Error('Review a fresh referral claim for this exact wallet and allocation.');
  const signature=Buffer.from(String(input.recipientSignature||''),'base64');
  if(signature.length!==64||!nacl.sign.detached.verify(new TextEncoder().encode(referralPayoutStatement(row)),signature,new PublicKey(row.recipient).toBytes()))
    throw new Error('The referral recipient must sign this claim.');
  return true;
}
