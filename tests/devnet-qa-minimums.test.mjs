import test from 'node:test';
import assert from 'node:assert/strict';
import { buybackTriggerLamports, STANDARD_BUYBACK_TRIGGER_LAMPORTS } from '../server/devnet-qa-minimums.mjs';

test('the 5 SOL buyback minimum remains the default', () => {
  assert.equal(buybackTriggerLamports('devnet', {}), STANDARD_BUYBACK_TRIGGER_LAMPORTS);
  assert.equal(buybackTriggerLamports('mainnet-beta',
    { FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:'10000000' }), STANDARD_BUYBACK_TRIGGER_LAMPORTS);
});

test('explicit Devnet QA profile accepts only a bounded trigger', () => {
  const env = { FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'true',
    FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:'10000000' };
  assert.equal(buybackTriggerLamports('devnet', env), 10_000_000n);
  assert.throws(() => buybackTriggerLamports('mainnet-beta', env), /outside Devnet/);
  for (const raw of ['', '10000', '9999999', '100000001', '0.01', '-10000000'])
    assert.throws(() => buybackTriggerLamports('devnet',
      { ...env,FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:raw }), /Devnet QA buyback trigger|positive/);
});
