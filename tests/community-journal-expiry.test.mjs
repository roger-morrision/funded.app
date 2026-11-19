import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { executeCommunityJournal, UNLANDED_MARGIN_BLOCKS } from '../server/community-execution-journal.mjs';
import { allocationAuditHash } from '../server/allocation-audit-hash.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

const mint = Keypair.generate().publicKey.toBase58(), key = `community:${mint}:open`;
const intent = { cluster:'devnet', approvedHash:'a'.repeat(64), mint, action:'open' };
const SIG = '5'.repeat(88);

function setup({ height, landed = false, status = null }) {
  const state = { communityExecutions:{ [key]:{ key, intent, intentHash:allocationAuditHash(intent), status:'verification-pending',
    signature:SIG, signedTransaction:'AA==', blockhash:'11111111111111111111111111111111', lastValidBlockHeight:1000, leaseUntil:0 } } };
  const store = { update:async fn => fn(state), read:async () => state };
  const connection = {
    getGenesisHash:async () => DEVNET_GENESIS_HASH,
    getSignatureStatuses:async () => ({ value:[status] }),
    isBlockhashValid:async () => ({ value:false }),
    getBlockHeight:async () => height,
    getTransaction:async () => landed ? { slot:1 } : null,
  };
  let prepared = 0;
  const run = () => executeCommunityJournal({ store, connection, key, intent, authority:Keypair.generate(),
    prepare:async () => { prepared += 1; throw Error('fresh-prepare'); }, prove:async () => null });
  return { state, run, prepared:() => prepared };
}

test('an expired, never-landed community transaction is retired and the next pass prepares afresh', async () => {
  const t = setup({ height:1000 + UNLANDED_MARGIN_BLOCKS + 1 });
  const result = await t.run();
  assert.equal(result.status, 'expired-unlanded');
  const row = t.state.communityExecutions[key];
  assert.equal(row.signature, undefined); assert.equal(row.signedTransaction, undefined);
  assert.equal(row.expiredAttempts.length, 1); assert.equal(row.expiredAttempts[0].signature, SIG);
  await assert.rejects(t.run(), /fresh-prepare/);
  assert.equal(t.prepared(), 1);
});

test('within the margin, with any signature status, or with a finalized receipt the attempt stays pending', async () => {
  for (const opts of [{ height:1000 + UNLANDED_MARGIN_BLOCKS }, { height:5000, landed:true },
    { height:5000, status:{ confirmationStatus:'processed', err:null } }]) {
    const t = setup(opts);
    const result = await t.run();
    assert.equal(result.status, 'verification-pending', JSON.stringify(opts));
    assert.equal(t.state.communityExecutions[key].signature, SIG);
    assert.equal(t.prepared(), 0);
  }
});
