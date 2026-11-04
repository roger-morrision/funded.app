import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Coin stats show a dash, not a wall of "Unavailable", when token data fails', () => {
  const js = readFileSync(new URL('../src/app/controllers/coin-community.js', import.meta.url), 'utf8');
  assert.match(js, /'#coin-top-ten-share','#coin-supply'\]\.forEach\(selector => appState\.setCoinField\(selector, '—'\)\);/);
  assert.doesNotMatch(js, /'#coin-supply'\]\.forEach\(selector => appState\.setCoinField\(selector, 'Unavailable'\)\)/);
});
