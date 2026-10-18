import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyBonusPayments, dailyBonusStatus } from '../src/features/fees/daily-bonus-payments.js';
const wallet = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
const payment = { finalized:true, balanceDeltaVerified:true, signature:'3'.repeat(64), amount:'500', amountReceived:'450' };
const snapshot = (...payments) => ({ sources:payments.map(row => ({ payments:{ [wallet]:row } })) });

test('daily bonus wallet totals use received amounts and deduplicate shared or replayed proofs', () => {
  const result = dailyBonusPayments(snapshot(payment, payment, { ...payment, signature:'4'.repeat(64), amountReceived:'300' })).get(wallet);
  assert.equal(result.receivedLamports, 750n);
  assert.equal(result.receipts.length, 2);
  assert.match(result.receipts[0].href, /cluster=devnet$/);
});
test('unfinalized or unlinked entries never become payment evidence', () => {
  for (const change of [{ finalized:false }, { balanceDeltaVerified:false }, { signature:'invalid' }, { amount:'0' }])
    assert.equal(dailyBonusPayments(snapshot({ ...payment, ...change })).size, 0);
});
test('missing or conflicting net evidence stays unavailable rather than treating gross as received', () => {
  for (const amountReceived of [undefined, '0', '-1', '501'])
    assert.equal(dailyBonusPayments(snapshot({ ...payment, amountReceived })).get(wallet).receivedLamports, null);
  const conflicting = dailyBonusPayments(snapshot(payment, { ...payment, amountReceived:'449' })).get(wallet);
  assert.equal(conflicting.receivedLamports, null);
  assert.equal(conflicting.receipts[0].receivedLamports, null);
});
test('recovered payment accounts can prove a receipt without a transaction signature', () => {
  const row = dailyBonusPayments(snapshot({ ...payment, signature:null, payment:'5'.repeat(44) })).get(wallet);
  assert.equal(row.receivedLamports, 450n);
  assert.match(row.receipts[0].href, /address\/5{44}\?cluster=devnet$/);
});
test('snapshot selection exposes reconciliation and unknown verification states', () => {
  const data = { worker:{ status:'active' }, payoutEnabled:true };
  assert.match(dailyBonusStatus(data, { day:'2026-10-17', status:'reconciliation-required', reason:'Changed evidence.' }, 'next'), /Further payouts are blocked.*Changed evidence/);
  assert.doesNotMatch(dailyBonusStatus(data, { status:'unrecognized' }, 'next'), /Verified snapshot/);
  assert.match(dailyBonusStatus(data, { status:'snapshotted' }, 'next'), /Verified snapshot/);
});

test('transaction and payment-account aliases identify the same received payment', () => {
  const full = { ...payment, payment:'5'.repeat(44) };
  for (const rows of [[payment, full], [full, payment], [{ ...full, signature:null }, full, payment]]) {
    const row = dailyBonusPayments(snapshot(...rows)).get(wallet);
    assert.equal(row.receivedLamports, 450n);
    assert.equal(row.receipts.length, 1);
  }
});
