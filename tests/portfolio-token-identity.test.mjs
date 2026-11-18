import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioTokenIdentity } from '../token-identity.js';

const MINT = 'H7ia4o8y4Wy4ZkGgqjtmBkfkrrbWVWeeWWBQE8vESpump';

test('portfolio holdings use the market name when on-chain metadata has none', () => {
  const identity = portfolioTokenIdentity(MINT, { market: { symbol: 'TRANS', name: 'TRANSFORMERS' } });
  assert.equal(identity.label, 'TRANS');
  assert.equal(identity.description, 'TRANSFORMERS');
});

test('on-chain metadata still wins over market data', () => {
  const identity = portfolioTokenIdentity(MINT, { metadata: { symbol: 'META', name: 'Meta name' }, market: { symbol: 'MKT', name: 'Market' } });
  assert.equal(identity.label, 'META');
});

test('no source still reads as unnamed', () => {
  assert.equal(portfolioTokenIdentity(MINT, {}).label, 'Unnamed token');
});
