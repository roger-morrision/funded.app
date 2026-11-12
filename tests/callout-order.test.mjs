import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCallouts, newestFirst } from '../src/features/callouts/callouts.js';

test('call lists show the newest call first', () => {
  const rows = [
    { id: 'a', author: 'w1', peakMultiple: 1, createdAt: '2026-11-10T10:00:00.000Z' },
    { id: 'b', author: 'w2', peakMultiple: 3, createdAt: '2026-11-12T09:00:00.000Z' },
    { id: 'c', author: 'w1', peakMultiple: 2, createdAt: '2026-11-11T12:00:00.000Z' },
  ];
  assert.deepEqual(newestFirst(rows).map(row => row.id), ['b', 'c', 'a']);
  assert.deepEqual(filterCallouts(rows).map(row => row.id), ['b', 'c', 'a']);
  assert.deepEqual(filterCallouts(rows, { filter: 'hot' }).map(row => row.id), ['b', 'c']);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c'], 'input order is not changed');
});
