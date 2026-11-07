import test from 'node:test';
import assert from 'node:assert/strict';
import { rentExempt, estimateProgram, estimateDeployment, LAMPORTS_PER_SOL } from '../scripts/estimate-program-deploy-cost.mjs';

test('rent matches the measured rent-exempt minimum and accepts a newer rate', () => {
  // getMinimumBalanceForRentExemption on devnet and mainnet, 2026-11-07.
  assert.equal(rentExempt(0), 650_240);
  assert.equal(rentExempt(1_000_000), 5_080_650_240);
  assert.equal(rentExempt(0, 6_960), 890_880, 'the pre-2026 rate');
});

test('upgradeable program rent covers program and ProgramData; the buffer is separate', () => {
  const row = estimateProgram({ name: 'p', bytes: 1_000_000 });
  assert.equal(row.maxLen, 1_000_000);
  assert.equal(row.lockedLamports, rentExempt(36) + rentExempt(45 + 1_000_000));
  assert.equal(row.bufferLamports, rentExempt(37 + 1_000_000));
  assert.equal(row.writes, 1_000);
  assert.equal(row.feeLamports, 1_002 * 5_000);
  // About 5.08 SOL locked for a 1 MB program.
  assert.ok(Math.abs(row.lockedLamports / LAMPORTS_PER_SOL - 5.082) < 0.01);
});

test('over-allocating max_len raises locked rent proportionally', () => {
  const exact = estimateProgram({ name: 'p', bytes: 500_000 });
  const doubled = estimateProgram({ name: 'p', bytes: 500_000, maxLenRatio: 2 });
  assert.ok(doubled.lockedLamports > exact.lockedLamports * 1.9);
  assert.equal(doubled.bufferLamports, exact.bufferLamports, 'the upload buffer only holds the binary');
  assert.throws(() => estimateProgram({ name: 'p', bytes: 1, maxLenRatio: 0.5 }), /at least 1/);
});

test('sequential deploys need only the largest buffer at once', () => {
  const plan = estimateDeployment([{ name: 'a', bytes: 900_000 }, { name: 'b', bytes: 200_000 }]);
  assert.equal(plan.largestBufferLamports, plan.rows[0].bufferLamports);
  assert.equal(plan.peakLamports, plan.lockedLamports + plan.feeLamports + plan.rows[0].bufferLamports);
});
