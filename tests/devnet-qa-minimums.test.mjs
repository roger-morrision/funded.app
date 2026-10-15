import test from 'node:test';
import assert from 'node:assert/strict';
import { buybackTriggerLamports, feeCollectionMinimumLamports,
  STANDARD_BUYBACK_TRIGGER_LAMPORTS,
  STANDARD_FEE_COLLECTION_MINIMUM_LAMPORTS } from '../server/devnet-qa-minimums.mjs';

test('the 5 SOL buyback minimum remains the default', () => {
  assert.equal(buybackTriggerLamports('devnet', {}), STANDARD_BUYBACK_TRIGGER_LAMPORTS);
  assert.equal(buybackTriggerLamports('mainnet-beta',
    { FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:'10000000' }), STANDARD_BUYBACK_TRIGGER_LAMPORTS);
});

test('explicit Devnet QA profile accepts only a bounded trigger', () => {
  const env = { FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'true',
    FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:'10000000' };
  assert.equal(buybackTriggerLamports('devnet', env), 10_000_000n);
  assert.equal(buybackTriggerLamports('devnet', { ...env,
    FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:'5000000' }), 5_000_000n);
  assert.throws(() => buybackTriggerLamports('mainnet-beta', env), /outside Devnet/);
  for (const raw of ['', '10000', '4999999', '100000001', '0.005', '-5000000'])
    assert.throws(() => buybackTriggerLamports('devnet',
      { ...env,FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS:raw }), /Devnet QA buyback trigger|positive/);
});

test('only the selected Devnet mint gets a bounded lower fee collection floor', () => {
  const mint = '2F6VAkmF6sXEwmY9No15EkthW7bwd2eocxM4yd8pWaRw';
  const env = { FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'true',
    FUNDED_DEVNET_QA_HOLDER_MINT:mint,
    FUNDED_DEVNET_QA_FEE_COLLECTION_MIN_LAMPORTS:'5000000' };
  assert.equal(feeCollectionMinimumLamports(mint, 'devnet', env), 5_000_000n);
  assert.equal(feeCollectionMinimumLamports('another-mint', 'devnet', env),
    STANDARD_FEE_COLLECTION_MINIMUM_LAMPORTS);
  assert.equal(feeCollectionMinimumLamports(mint, 'devnet', { ...env,
    FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'false' }), STANDARD_FEE_COLLECTION_MINIMUM_LAMPORTS);
  assert.throws(() => feeCollectionMinimumLamports(mint, 'mainnet-beta', env), /outside Devnet/);
  for (const raw of ['', '999999', '10000000', '0.005', '-1'])
    assert.throws(() => feeCollectionMinimumLamports(mint, 'devnet', { ...env,
      FUNDED_DEVNET_QA_FEE_COLLECTION_MIN_LAMPORTS:raw }), /minimum/);
});
