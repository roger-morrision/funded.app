import assert from 'node:assert/strict';
import { formatTokenBaseAmount, tokenBalancePercentage } from '../trade-panel-balance.js';

assert.equal(formatTokenBaseAmount(12_345_678_900n, 6), '12345.6789');
assert.equal(formatTokenBaseAmount(12_345_678_900n, 6, 2), '12345.67');
assert.equal(tokenBalancePercentage(12_345_678_901n, 6, 25), '3086.419725');
assert.equal(tokenBalancePercentage(12_345_678_901n, 6, 100), '12345.678901');
assert.equal(tokenBalancePercentage(1n, 6, 10), '0');
console.log('Trade balance percentage checks passed.');
