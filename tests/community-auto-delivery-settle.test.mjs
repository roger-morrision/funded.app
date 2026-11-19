import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createCommunityAutoDelivery } from '../server/community-auto-delivery.mjs';

const mint = Keypair.generate().publicKey.toBase58(), SIG = '4'.repeat(88);
const authority = Keypair.generate();

function setup({ status, opened = true, expiresAt = 2_000_000_000, now = 1_900_000_000_000 }) {
  const state = { communityExecutions:{ [`community:${mint}:open`]:{ status:'verification-pending', signature:SIG, signedTransaction:'AA==' } } };
  const store = { read:async () => state, update:async fn => fn(state) };
  let executed = 0;
  const delivery = createCommunityAutoDelivery({ store, service:{}, authority, programId:'p', approvedHash:'a'.repeat(64), now:() => now,
    connection:{ getSignatureStatuses:async () => ({ value:[status] }), getAccountInfo:async () => null },
    execute:async () => { executed += 1; return { status:'verification-pending' }; } });
  const record = { mint, openingSignature:opened ? SIG : null, snapshotBasis:'pump-migration', manifest:{ expiresAt } };
  return { state, delivery, record, executed:() => executed };
}

test('an opened drop settles its pending journal row once the signature is finalized without error', async () => {
  const t = setup({ status:{ confirmationStatus:'finalized', err:null } });
  assert.equal((await t.delivery.open(t.record)).status, 'opened');
  const row = t.state.communityExecutions[`community:${mint}:open`];
  assert.equal(row.status, 'finalized'); assert.equal(row.signedTransaction, undefined); assert.equal(row.reconciledBy, 'chain-status');
});

test('the journal row stays pending for unfinalized or failed signatures', async () => {
  for (const status of [null, { confirmationStatus:'confirmed', err:null }, { confirmationStatus:'finalized', err:{ x:1 } }]) {
    const t = setup({ status });
    await t.delivery.open(t.record);
    assert.equal(t.state.communityExecutions[`community:${mint}:open`].status, 'verification-pending');
  }
});

test('an unopened drop past its expiry builds no further opening attempts', async () => {
  const t = setup({ status:null, opened:false, expiresAt:1_800_000_000 });
  assert.equal((await t.delivery.open(t.record)).status, 'expired');
  assert.equal(t.executed(), 0);
});
