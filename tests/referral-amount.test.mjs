import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReferralLamports } from '../referral-amount.js';

test('referral display preserves lamport precision for all three QA payouts', () => {
  assert.equal(formatReferralLamports('57714'), '0.000057714');
  assert.equal(formatReferralLamports('17314'), '0.000017314');
  assert.equal(formatReferralLamports('11543'), '0.000011543');
  assert.equal(formatReferralLamports(0n), '0.0000');
  assert.equal(formatReferralLamports(1_000_000_001n), '1.000000001');
  assert.throws(() => formatReferralLamports('-1'));
});
