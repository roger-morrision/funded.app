import test from 'node:test';
import assert from 'node:assert/strict';
import { serverCoinIdentity } from '../src/features/coin/server-identity.js';

const mint = 'APjV65KZhb2AshXJDoHVVatxsGWV4GUEWdU6Q3WZoVMn';
const page = ({ title, url, canonical } = {}) => ({
  querySelector: selector => {
    if (selector === 'meta[property="og:title"]' && title != null) return { getAttribute: () => title };
    if (selector === 'meta[property="og:url"]' && url != null) return { getAttribute: () => url };
    if (selector === 'link[rel="canonical"]' && canonical != null) return { getAttribute: () => canonical };
    return null;
  },
});

test('server coin identity reads the verified name and symbol for the served mint', () => {
  const document = page({ title: 'Devnet flow check (FLOWQA) | funded.vip', url: `https://funded.vip/token/${mint}?ref=FND-ABCDEFGH` });
  assert.deepEqual(serverCoinIdentity(mint, document), { name: 'Devnet flow check', symbol: 'FLOWQA' });
  assert.deepEqual(serverCoinIdentity(mint, page({ title: 'Moon (cat) (MOON) | funded.vip', canonical: `https://funded.vip/token/${mint}` })), { name: 'Moon (cat)', symbol: 'MOON' });
});

test('server coin identity ignores other mints, unverified titles and missing tags', () => {
  const other = 'G3ZiWvn659PL4a4Q5iCjqP5Wi9gVJZ2FTxsswLwtzHzR';
  assert.equal(serverCoinIdentity(other, page({ title: 'Devnet flow check (FLOWQA) | funded.vip', url: `https://funded.vip/token/${mint}` })), null);
  assert.equal(serverCoinIdentity(mint, page({ title: 'Token verification unavailable | funded.vip', url: `https://funded.vip/token/${mint}` })), null);
  assert.equal(serverCoinIdentity(mint, page({ title: 'Devnet flow check (FLOWQA) | funded.vip' })), null);
  assert.equal(serverCoinIdentity('', page()), null);
  assert.equal(serverCoinIdentity(mint, null), null);
});
