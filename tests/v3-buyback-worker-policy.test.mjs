import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { shouldAttemptV3Buyback } from '../server/v3-buyback-worker-policy.mjs';

const mint = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58();
const row = status => ({ status, mint, sourceCollectionSignature:'4'.repeat(64) });

test('a finalized burn residue waits for a fresh 5 SOL trigger', () => {
  assert.equal(shouldAttemptV3Buyback(row('verified-burn-residue'),
    { triggerReached:false, now:1000 }), false);
  assert.equal(shouldAttemptV3Buyback(row('verified-burn-residue'),
    { triggerReached:true, now:1000 }), true);
  assert.equal(shouldAttemptV3Buyback(row('awaiting-v3-buyback-executor'),
    { triggerReached:false, now:1000 }), false);
});

test('an existing queued cycle can finish below 5 SOL and retry safely', () => {
  assert.equal(shouldAttemptV3Buyback(row('queued'),
    { triggerReached:false, now:1000 }), true);
  assert.equal(shouldAttemptV3Buyback(row('verification-pending'),
    { triggerReached:false, retryAt:2000, now:1000 }), true);
  assert.equal(shouldAttemptV3Buyback(row('queued'),
    { triggerReached:true, retryAt:2000, now:1000 }), false);
  assert.equal(shouldAttemptV3Buyback(row('verified-burn-residue'),
    { triggerReached:true, retryAt:2000, now:1000 }), false);
  assert.equal(shouldAttemptV3Buyback({ ...row('verified-burn-residue'), mint:'invalid' },
    { triggerReached:true, now:1000 }), false);
});
