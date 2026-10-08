import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenAge, tokenMarketCap } from '../token-list-market-state.js';

test('market cap uses the active market and never falls back to a completed curve', () => {
  const item = { complete: false, curveCapSol: 100, marketCapUsd: 999999 };
  assert.equal(tokenMarketCap(item, 'devnet', 150), '$15K');
  assert.equal(tokenMarketCap({ ...item, complete: true }, 'devnet', 150), 'Unavailable');
  assert.equal(tokenMarketCap({ ...item, complete: true, migrated: true, poolMarketCapSol: 200 }, 'devnet', 150), '$30K');
  assert.equal(tokenMarketCap({ ...item, migrated: true }, 'devnet', 150), 'Unavailable');
  assert.equal(tokenMarketCap(item, 'devnet', null), '100 SOL');
  assert.equal(tokenMarketCap({ complete: false }, 'devnet', 150), 'Unavailable');
  assert.equal(tokenMarketCap({ marketCapUsd: 12000 }, 'mainnet-beta', null), '$12K');
});

test('age supports registry dates and feed seconds or milliseconds without inventing missing ages', () => {
  const launched = Date.parse('2026-10-01T00:00:00Z');
  const now = launched + 3 * 86400000;
  for (const value of [launched, launched / 1000, '2026-10-01T00:00:00Z']) {
    assert.deepEqual(tokenAge(value, now), { label: '3d', timestamp: '2026-10-01T00:00:00.000Z' });
  }
  for (const value of [null, undefined, '', 'bad date', now + 1000]) assert.equal(tokenAge(value, now).label, 'Unavailable');
});
