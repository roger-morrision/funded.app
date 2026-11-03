import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPayoutSol } from '../src/features/home/payout-feed.js';

test('home payout strip shows real small amounts instead of a "<0.0001" placeholder', () => {
  assert.equal(formatPayoutSol(42_000), '0.000042 SOL');
  assert.equal(formatPayoutSol(43_210), '0.000043 SOL');
  assert.equal(formatPayoutSol(5), '0.000000005 SOL');
  assert.equal(formatPayoutSol(100_000), '0.0001 SOL');
  assert.equal(formatPayoutSol(14_000_000), '0.014 SOL');
  assert.equal(formatPayoutSol(2_500_000_000), '2.5 SOL');
  assert.equal(formatPayoutSol(0), '');
  assert.equal(formatPayoutSol('bad'), '');
});
