import assert from 'node:assert/strict';
import test from 'node:test';
import { exactSolLamports } from '../server/exact-sol-units.mjs';

test('canonical decimal numbers and exponent spellings preserve exact lamports', () => {
  for (const [value, expected] of [[0, '0'], [1.5e-8, '15'], [3e-8, '30'], [6.1e-8, '61'], [0.000000001, '1'],
    [1.23456789, '1234567890'], ['0.000000015', '15'], ['1.000000001', '1000000001'], ['0.0000000010', '1'],
    ['9007199.254740991', String(Number.MAX_SAFE_INTEGER)]]) assert.equal(exactSolLamports(value), expected);
});

test('unsafe or sub-lamport amounts are rejected without rounding or coercion', () => {
  for (const value of [1e-10, 1.51e-8, 0.0000000010000001, '0.0000000001', '9007199.254740992', 1e21,
    Infinity, NaN, -1, '', ' 1', '01', '1e-8', {}, null, true, '1'.repeat(100)]) {
    assert.throws(() => exactSolLamports(value), /Exact SOL amount unavailable/, String(value));
  }
});
