import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {prepareManualReferralPayout,verifyManualReferralPayout,referralPayoutStatement} from '../server/manual-referral-payout.mjs';
test('referral approval binds recipient, amount, source, mint, level and expiry',async()=>{
  const recipient=Keypair.fromSeed(Buffer.alloc(32,183));const state={};
  const intent={mint:Keypair.fromSeed(Buffer.alloc(32,184)).publicKey.toBase58(),collectionSignature:'source',level:1,recipient:recipient.publicKey.toBase58(),amount:'6000'};
  const row=await prepareManualReferralPayout({update:async fn=>fn(state)},intent,100000);
  const input={claimNonce:row.nonce,recipientSignature:Buffer.from(nacl.sign.detached(new TextEncoder().encode(referralPayoutStatement(row)),recipient.secretKey)).toString('base64')};
  assert.equal(verifyManualReferralPayout(state,intent,input,100001),true);
  for(const field of ['mint','collectionSignature','level','recipient','amount'])assert.throws(()=>verifyManualReferralPayout(state,{...intent,[field]:field==='level'?2:'changed'},input,100001));
  assert.throws(()=>verifyManualReferralPayout(state,intent,input,400000));
  assert.throws(()=>verifyManualReferralPayout(state,intent,{...input,claimNonce:'old'},100001));
  assert.throws(()=>verifyManualReferralPayout(state,intent,{...input,recipientSignature:Buffer.alloc(64).toString('base64')},100001));
});
