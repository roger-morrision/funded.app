import assert from 'node:assert/strict';
import test from 'node:test';
import { emitPilotSignal, pilotInterruptedSignal, verifiedPilotLaunchRegistration } from '../pilot-event-signals.js';

test('pilot events disclose only an allowlisted stage and never interfere with transaction code', () => {
  const target = new EventTarget(), rows = [];
  target.addEventListener('funded:pilot-event', event => rows.push(event.detail));
  assert.equal(emitPilotSignal('claim-verified', target), true);
  assert.deepEqual(rows, [{ name: 'claim-verified' }]);
  assert.equal(emitPilotSignal('wallet-address-or-error-message', target), false);
  assert.equal(emitPilotSignal({ name: 'claim-verified', wallet: 'private' }, target), false);
  assert.equal(emitPilotSignal('claim-verified', { dispatchEvent() { throw new Error('Recorder unavailable'); } }), false);
  assert.equal(emitPilotSignal('claim-verified', null), false);
  assert.equal(rows.length, 1);
});

test('only explicit wallet rejection before submission is classified as cancellation', () => {
  for (const code of [4001, '4001', 'ACTION_REJECTED']) {
    assert.equal(pilotInterruptedSignal('launch', { code }), 'launch-cancelled');
    assert.equal(pilotInterruptedSignal('claim', { code }), 'claim-cancelled');
    assert.equal(pilotInterruptedSignal('launch', { code }, true), 'launch-stopped');
    assert.equal(pilotInterruptedSignal('claim', { code }, true), 'claim-pending');
  }
  for (const error of [new Error('User rejected transaction'), new TypeError('Network failed'), { code: 500 }, null]) {
    assert.equal(pilotInterruptedSignal('launch', error), 'launch-stopped');
    assert.equal(pilotInterruptedSignal('claim', error), 'claim-stopped');
    assert.equal(pilotInterruptedSignal('claim', error, true), 'claim-pending');
  }
  assert.equal(pilotInterruptedSignal('trade', {}), null);
});

test('launch confirmation requires matching Devnet on-chain registry evidence, not HTTP availability', () => {
  const mint = 'test-mint';
  const response = { available: true, data: { mint, cluster: 'devnet', onchainVerified: true } };
  assert.equal(verifiedPilotLaunchRegistration(response, mint), true);
  for (const altered of [null, { available: false, data: response.data }, { available: true },
    { ...response, data: { ...response.data, onchainVerified: false } },
    { ...response, data: { ...response.data, onchainVerified: 'true' } },
    { ...response, data: { ...response.data, mint: 'another-mint' } },
    { ...response, data: { ...response.data, cluster: 'mainnet-beta' } }]) {
    assert.equal(verifiedPilotLaunchRegistration(altered, mint), false);
  }
});
