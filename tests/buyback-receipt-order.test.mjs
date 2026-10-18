import test from 'node:test';
import assert from 'node:assert/strict';
import { newestBuybackReceipts } from '../src/features/funded/buyback-receipts.js';

test('both buyback histories prefer confirmed slots over clocks and leave API data unchanged', () => {
  const older = Object.freeze({ signature:'older', slot:100, burnedAt:'2026-10-18T13:00:00Z' });
  const newer = Object.freeze({ signature:'newer', slot:101, burnedAt:'2026-10-18T12:00:00Z' });
  const input = Object.freeze([older, newer]);
  assert.deepEqual(newestBuybackReceipts(input), [newer, older]);
  assert.deepEqual(input, [older, newer]);
});

test('legacy receipts without slots use verified dates and deterministic ties', () => {
  const receipts = [
    {signature:'z', burnedAt:'2026-10-18T12:00:00Z'},
    {signature:'a', finalizedAt:'2026-10-18T13:00:00Z'},
    {signature:'b', finalizedAt:'2026-10-18T13:00:00Z'},
    {signature:'invalid', slot:NaN, burnedAt:'invalid'},
  ];
  assert.deepEqual(newestBuybackReceipts(receipts).map(row=>row.signature), ['a','b','z','invalid']);
});
