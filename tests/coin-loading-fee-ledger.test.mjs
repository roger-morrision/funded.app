import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedSharedRouterFeeCollections } from '../src/app/controllers/coin-loading.js';

test('V3 fee activity without a shared router does not break token detail', () => {
  const response = { cluster:'devnet', collections:[], claims:[], sharedRouter:null };
  assert.deepEqual(linkedSharedRouterFeeCollections(response, undefined), { linked:false, collections:[] });
  assert.deepEqual(linkedSharedRouterFeeCollections(response, 'creator-address'), { linked:false, collections:[] });
});

test('combined collections appear only when the on-chain creator matches a real router address', () => {
  const response = { sharedRouter:{ address:'router-address', collections:[{ signature:'combined-fee' }] } };
  assert.deepEqual(linkedSharedRouterFeeCollections(response, 'other-creator'), { linked:false, collections:[] });
  assert.deepEqual(linkedSharedRouterFeeCollections(response, 'router-address'), {
    linked:true, collections:[{ signature:'combined-fee' }],
  });
});
