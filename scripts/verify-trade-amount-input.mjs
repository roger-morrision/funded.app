import assert from 'node:assert/strict';
import { formatTradeAmountInput, parseTradeAmountInput } from '../trade-amount-input.js';

for (const [typed, displayed, numeric] of [
  ['10000000', '10,000,000', 10_000_000],
  ['1,234,567.125', '1,234,567.125', 1_234_567.125],
  ['0.10', '0.10', 0.1],
  ['.5', '0.5', 0.5],
]) {
  assert.equal(formatTradeAmountInput(typed), displayed);
  assert.equal(parseTradeAmountInput(displayed), numeric);
}

for (const invalid of ['', '1e7', '10 million', '1.2.3']) {
  assert.ok(Number.isNaN(parseTradeAmountInput(invalid)), `Rejected malformed amount: ${invalid}`);
}

console.log('Trade amount grouping preserves exact numeric values and rejects malformed input.');
