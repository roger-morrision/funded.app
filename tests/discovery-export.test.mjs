import assert from 'node:assert/strict';
import test from 'node:test';
import { exploreFilterUrl, readExploreFilterUrl } from '../explore-filter-url.js';
import { receiptPageCsv } from '../receipt-export.js';

test('shared searches round trip public filters without tokens or unrelated query parameters', () => {
  const url = exploreFilterUrl('https://example.com/token/mint?session=secret', { 'explore-search': '<coin>& test', stage: 'migrated', session: 'secret' });
  assert.equal(new URL(url).pathname, '/explore');
  assert.equal(url.includes('secret'), false);
  assert.equal(readExploreFilterUrl(url)['explore-search'], '<coin>& test');
  assert.equal(readExploreFilterUrl('https://example.com/explore'), null);
});
test('CSV preserves integer precision and neutralizes spreadsheet formulas', () => {
  const signature = '1'.repeat(88);
  const csv = receiptPageCsv([{ signature, amountLamports: '18446744073709551615', slot: 22, mint: '=IMPORTXML("url")', paidAt: '2026-10-04' }], 'devnet', 2);
  assert.ok(csv.includes('18446744073709551615'));
  assert.ok(csv.includes("\"'=IMPORTXML"));
  assert.ok(csv.includes('current verified page only'));
  assert.equal(receiptPageCsv([{ signature: 'invalid' }], 'devnet', 1).split('\r\n').length, 2);
});

test('malformed shared URLs are ignored and receipt exports reject invalid pages', () => {
  assert.equal(readExploreFilterUrl('not a url'), null);
  assert.throws(() => receiptPageCsv([], 'devnet', 0), /Invalid receipt page/);
  const receipt = { signature: '1'.repeat(88), amountLamports: '100', slot: 3 };
  const csv = receiptPageCsv([null, receipt, receipt], 'devnet', 1);
  assert.equal(csv.split('\r\n').length, 3, 'One header and one unique valid receipt');
});

test('receipt CSV includes an exact human-readable SOL amount without floating point rounding', async () => {
  const { formatReceiptSol } = await import('../receipt-export.js');
  assert.equal(formatReceiptSol('1'), '0.000000001');
  assert.equal(formatReceiptSol('1000000000'), '1');
  assert.equal(formatReceiptSol('18446744073709551615'), '18446744073.709551615');
  assert.throws(() => formatReceiptSol('-1'), /Invalid SOL amount/);
  const csv = receiptPageCsv([{ signature: '1'.repeat(88), amountLamports: '18446744073709551615', slot: 22 }], 'devnet', 1);
  assert.ok(csv.includes('"amount_sol"'));
  assert.ok(csv.includes('"18446744073.709551615"'));
});
