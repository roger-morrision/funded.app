import assert from 'node:assert/strict';
import { createReferralAuth } from '../server/referral-auth.mjs';

const rows = new Map();
const store = {
  async authPut(kind,key,payload,expiresAt){ rows.set(`${kind}:${key}`,{payload,expiresAt}); },
  async authRead(kind,key){ const row=rows.get(`${kind}:${key}`);return row?.expiresAt>Date.now()?row.payload:null; },
  async authTake(kind,key){ const mapKey=`${kind}:${key}`,row=rows.get(mapKey);rows.delete(mapKey);return row?.expiresAt>Date.now()?row.payload:null; },
  async authDelete(kind,key){ rows.delete(`${kind}:${key}`); },
};
const wallet='11111111111111111111111111111111';
const accepted=[];
const auth=createReferralAuth(store,{verifyMessage:(statement,signature,address)=>{accepted.push({statement,signature,address});return signature==='synthetic-approved';}});

const first=await auth.start(wallet);
assert.match(first.challengeId,/^[A-Za-z0-9_-]{43}$/);
assert.match(first.statement,/funded\.app referral dashboard/);
assert.equal((await auth.verify(first.challengeId,wallet,'wrong')),null);
assert.equal((await auth.verify(first.challengeId,wallet,'synthetic-approved')),null,'A failed approval consumes its challenge.');

const second=await auth.start(wallet);
const session=await auth.verify(second.challengeId,wallet,'synthetic-approved');
assert.equal(session.wallet,wallet);
assert.equal((await auth.session(session.token)).wallet,wallet);
assert.ok(![...rows.keys()].some(key=>key.includes(session.token)),'Raw referral bearer tokens must not be stored.');
await auth.revoke(session.token);
assert.equal(await auth.session(session.token),null);
assert.equal(accepted.at(-1).address,wallet);
console.log('Referral auth: wallet-scoped, single-use approval, hashed session storage and logout passed with a synthetic verifier. No signing or secret used.');
