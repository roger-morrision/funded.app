import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCallouts } from '../src/features/callouts/callouts.js';
import { walletLookupPath } from '../src/features/portfolio/wallet-lookup.js';

const A = 'A'.repeat(32), B = 'B'.repeat(32);

test('coin calls can be filtered to one token', () => {
  const calls = [
    { id: '1', mint: A, author: 'w1', createdAt: '2026-11-15T01:00:00Z', peakMultiple: 1 },
    { id: '2', mint: B, author: 'w1', createdAt: '2026-11-15T02:00:00Z', peakMultiple: 3 },
    { id: '3', mint: A, author: 'w2', createdAt: '2026-11-15T03:00:00Z', peakMultiple: 2 },
  ];
  assert.deepEqual(filterCallouts(calls, { mint: A }).map(row => row.id), ['3', '1']);
  assert.deepEqual(filterCallouts(calls, { mint: A, filter: 'hot' }).map(row => row.id), ['3']);
  assert.equal(filterCallouts(calls).length, 3);
});

test('wallet lookup accepts only Solana addresses', () => {
  assert.equal(walletLookupPath(`  ${A} `), `/wallet/${A}`);
  assert.equal(walletLookupPath('not a wallet'), null);
  assert.equal(walletLookupPath('0'.repeat(40)), null);
});
