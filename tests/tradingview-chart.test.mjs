import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservedCandles } from '../src/features/coin/chart-data.js';

const now = 1_800_000_000;
const options = { decimals: 6, period: '1h', nowSeconds: now };
const trade = (time, price, amount = '1000000000', signature = `${time}-${price}`) => ({ blockTime: time, priceRatio: price, solLamports: amount, signature });

test('candles sort reported trades, aggregate exact OHLC and SOL volume, and retain gaps', () => {
  const rows = [trade(now - 1, 3), trade(now - 121, 4), trade(now - 130, 1), trade(now - 140, 2)];
  const result = buildObservedCandles(rows, options);
  assert.equal(result.count, 4);
  assert.deepEqual(result.candles, [
    { time: now - 180, open: .002, high: .004, low: .001, close: .004 },
    { time: now - 60, open: .003, high: .003, low: .003, close: .003 },
  ]);
  assert.deepEqual(result.volumes.map(row => row.value), [3, 1]);
  assert.deepEqual(result.series, [result.candles[0], { time: now - 120 }, result.candles[1]], 'Unobserved intervals are whitespace, never copied OHLC');
  assert.deepEqual(rows.map(row => row.priceRatio), [3, 4, 1, 2], 'Input order is unchanged');
});

test('chart conversion applies token decimals, supply and SOL/USD exactly once', () => {
  const rows = [trade(now, 2)];
  assert.equal(buildObservedCandles(rows, options).latest, .002);
  assert.equal(buildObservedCandles(rows, { ...options, metric: 'mcap', supply: 1000 }).latest, 2);
  assert.equal(buildObservedCandles(rows, { ...options, metric: 'mcap', supply: 1000, unit: 'usd', solUsdPrice: 100 }).latest, 200);
  assert.equal(buildObservedCandles(rows, { ...options, unit: 'usd', solUsdPrice: 100 }).latest, .2);
});

test('invalid observations, exact duplicates and out-of-range trades do not invent candles or volume', () => {
  const valid = trade(now, 2);
  const result = buildObservedCandles([valid, valid, trade(now, -1), trade(now, Infinity), trade(now, null), trade(now - 4000, 8), trade(now + 200, 7), trade(null, 4)], options);
  assert.equal(result.count, 1); assert.equal(result.candles.length, 1);
  assert.equal(result.volumes[0].value, 1);
  assert.equal(buildObservedCandles([trade(now, 2, null)], options).volumes.length, 0);
  assert.equal(buildObservedCandles([], options).candles.length, 0);
});

test('missing conversions and invalid decimals fail closed while a single confirmed trade remains drawable', () => {
  const rows = [trade(now, 2)];
  for (const patch of [{ decimals: null }, { decimals: -1 }, { decimals: 1.5 }, { metric: 'mcap', supply: 0 }, { unit: 'usd', solUsdPrice: null }]) {
    const result = buildObservedCandles(rows, { ...options, ...patch });
    assert.equal(result.candles.length, 0); assert.ok(result.reason);
  }
  assert.equal(buildObservedCandles(rows, options).candles.length, 1);
  assert.equal(buildObservedCandles(rows, { ...options, period: '5m' }).interval, 15);
  assert.equal(buildObservedCandles(rows, { ...options, period: '6h' }).interval, 300);
});
