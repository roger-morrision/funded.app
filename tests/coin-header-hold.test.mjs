import test from 'node:test';
import assert from 'node:assert/strict';
import { isHeaderPlaceholder, coinMintFromLocation, readHeaderCache, writeHeaderCache } from '../src/features/coin/header-hold.js';

const MINT = '9a5uUXxa7LzHkT6YUikttpQsUZm4Etw8qhd2HP7xpump';
const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };

test('dash and loading text count as placeholders, numbers do not', () => {
  for (const text of ['$—', '—', '', '24h —', 'Loading…', 'Checking…', 'Reading trades…']) assert.equal(isHeaderPlaceholder(text), true, text);
  for (const text of ['$47,839', '$0.0₄4951', '5.18% · 24h', '1,489', 'Bonding curve', 'Not indexed', '$0']) assert.equal(isHeaderPlaceholder(text), false, text);
});

test('coin mint comes from token paths and coin hashes only', () => {
  assert.equal(coinMintFromLocation({ pathname: `/token/${MINT}`, hash: '' }), MINT);
  assert.equal(coinMintFromLocation({ pathname: '/', hash: `#coin/${MINT}` }), MINT);
  assert.equal(coinMintFromLocation({ pathname: `/token/${MINT}`, hash: '#explore' }), '');
  assert.equal(coinMintFromLocation({ pathname: '/token/not-a-mint', hash: '' }), '');
});

test('header cache returns fresh values and drops stale ones', () => {
  const storage = memory();
  writeHeaderCache(storage, MINT, { 'coin-price': '$0.05' }, 1_000);
  assert.deepEqual(readHeaderCache(storage, MINT, 2_000), { 'coin-price': '$0.05' });
  assert.equal(readHeaderCache(storage, MINT, 1_000 + 31 * 60_000), null);
  assert.equal(readHeaderCache({ getItem() { throw new Error('blocked'); } }, MINT), null);
});
