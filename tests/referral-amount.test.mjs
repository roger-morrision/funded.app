import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReferralLamports, paidReferralLamports } from '../referral-amount.js';

test('referral display preserves lamport precision for all three QA payouts', () => {
  assert.equal(formatReferralLamports('57714'), '0.000057714');
  assert.equal(formatReferralLamports('17314'), '0.000017314');
  assert.equal(formatReferralLamports('11543'), '0.000011543');
  assert.equal(formatReferralLamports(0n), '0.0000');
  assert.equal(formatReferralLamports(1_000_000_001n), '1.000000001');
  assert.throws(() => formatReferralLamports('-1'));
});

test('reward summary counts only exact finalized referral SOL and does not hide malformed receipts', () => {
  assert.equal(paidReferralLamports([
    { asset:'SOL', status:'paid', amountLamports:'57714' },
    { asset:'SOL', status:'paid', amountLamports:'17314' },
    { asset:'SOL', status:'awaiting-wallet-signature', amountLamports:'1000000000' },
    { asset:'TOKEN', status:'paid', amountLamports:'999' },
  ]), 75028n);
  assert.equal(paidReferralLamports([]), 0n);
  assert.equal(paidReferralLamports(null), null);
  assert.equal(paidReferralLamports([{ asset:'SOL', status:'paid', amountLamports:'invalid' }]), null);
});
