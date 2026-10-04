import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptPaidAtDate } from '../receipt-timestamp.js';

test('receipt timestamps preserve explicit ISO instants, including real epoch and timezone offsets', () => {
  for (const [input, expected] of [
    ['2026-10-04T05:00:00Z', '2026-10-04T05:00:00.000Z'],
    ['2026-10-04T05:00:00.123Z', '2026-10-04T05:00:00.123Z'],
    ['2026-10-04T05:00:00.1+05:30', '2026-10-03T23:30:00.100Z'],
    ['2026-10-04T05:00:00.12-04:00', '2026-10-04T09:00:00.120Z'],
    ['2000-02-29T12:00:00Z', '2000-02-29T12:00:00.000Z'],
    ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00.000Z'],
  ]) assert.equal(receiptPaidAtDate(input)?.toISOString(), expected, input);
});

test('unknown receipt timestamps never coerce missing values or non-ISO types into dates', () => {
  for (const value of [null, undefined, false, true, 0, 1, 1728000000, NaN, {}, [], new Date(0), '', ' ', '0', '1728000000',
    '2026-10-04', '2026-10-04T05:00:00', '2026-10-04T05:00Z', ' 2026-10-04T05:00:00Z', '2026-10-04T05:00:00Z ',
    '10/04/2026', 'not-a-date', '2026-10-04T05:00:00.1234Z', '0'.repeat(10000)]) {
    assert.equal(receiptPaidAtDate(value), null, String(value));
  }
});

test('calendar overflow and invalid time or offset components remain unknown', () => {
  for (const value of ['2026-02-29T12:00:00Z', '1900-02-29T12:00:00Z', '2026-02-30T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-00-01T12:00:00Z', '2026-13-01T12:00:00Z', '2026-01-00T12:00:00Z', '2026-01-32T12:00:00Z',
    '2026-10-04T24:00:00Z', '2026-10-04T12:60:00Z', '2026-10-04T12:00:60Z', '2026-10-04T12:00:00+24:00',
    '2026-10-04T12:00:00-05:60']) assert.equal(receiptPaidAtDate(value), null, value);
});
