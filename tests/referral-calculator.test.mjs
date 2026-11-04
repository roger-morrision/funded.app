import test from 'node:test';
import assert from 'node:assert/strict';
import { referralEarnings } from '../src/features/fees/referral-calculator.js';

test('referral calculator splits creator fees by level rate', () => {
  const rows = referralEarnings(10, [{ level:1, rate:0.6 }, { level:2, rate:0.25 }, { level:3, rate:0.15 }]);
  assert.deepEqual(rows.map(row => row.sol), [0.06, 0.025, 0.015]);
  assert.equal(rows[0].label, 'Direct (L1)');
});

test('referral calculator rejects negative or non-numeric fees', () => {
  assert.equal(referralEarnings(-1, [{ level:1, rate:0.6 }]), null);
  assert.equal(referralEarnings('abc', [{ level:1, rate:0.6 }]), null);
});
