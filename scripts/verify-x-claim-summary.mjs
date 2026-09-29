import assert from 'node:assert/strict';
import { summarizeXClaims, formatXClaimSol } from '../x-claim-summary.js';

const summary = summarizeXClaims([
  { amountSol: 0.000118812, receiptVerified: true, canPrepare: false },
  { amountSol: 0.1, receiptVerified: false, canPrepare: true },
  { amountSol: 0.02, receiptVerified: false, canPrepare: false },
]);
assert.deepEqual(Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value.count])), { total: 3, claimed: 1, unclaimed: 1, pending: 1 });
assert.equal(formatXClaimSol(summary.total), '0.120118812 SOL');
assert.equal(formatXClaimSol(summary.claimed), '0.000118812 SOL');
assert.equal(formatXClaimSol(summary.unclaimed), '0.1 SOL');
assert.equal(formatXClaimSol(summary.pending), '0.02 SOL');

const incomplete = summarizeXClaims([{ amountSol: 1, canPrepare: true }, { amountSol: null, canPrepare: true }]);
assert.equal(formatXClaimSol(incomplete.total), '—');
assert.equal(formatXClaimSol(incomplete.unclaimed), '—');
assert.equal(formatXClaimSol(incomplete.claimed), '0 SOL');
assert.equal(summarizeXClaims(null), null);

// A new collected reward moves through the claim flow without changing the
// total collected amount. Only a verified receipt moves it into Claimed.
const priorPayment = { amountSol: 0.000118812, receiptVerified: true, canPrepare: false };
const newReward = { amountSol: 0.000023762, receiptVerified: false, canPrepare: true };
const expectedStages = [
  [{ ...newReward }, { total: '0.000142574 SOL', claimed: '0.000118812 SOL', unclaimed: '0.000023762 SOL', pending: '0 SOL' }],
  [{ ...newReward, canPrepare: false }, { total: '0.000142574 SOL', claimed: '0.000118812 SOL', unclaimed: '0 SOL', pending: '0.000023762 SOL' }],
  [{ ...newReward, receiptVerified: true, canPrepare: false }, { total: '0.000142574 SOL', claimed: '0.000142574 SOL', unclaimed: '0 SOL', pending: '0 SOL' }],
];
for (const [reward, expected] of expectedStages) {
  const buckets = summarizeXClaims([priorPayment, reward]);
  for (const [name, value] of Object.entries(expected)) assert.equal(formatXClaimSol(buckets[name]), value, `${name} at claim stage`);
  assert.equal(buckets.total.lamports, buckets.claimed.lamports + buckets.unclaimed.lamports + buckets.pending.lamports);
  assert.equal(buckets.total.count, buckets.claimed.count + buckets.unclaimed.count + buckets.pending.count);
}
console.log('X claim summary totals, claim-stage transitions, and missing-amount handling verified.');
