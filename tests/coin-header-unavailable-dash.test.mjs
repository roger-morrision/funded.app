import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Coin header shows a dash, not "Unavailable" twice, when market data fails', () => {
  const js = readFileSync(new URL('../src/app/controllers/coin-community.js', import.meta.url), 'utf8');
  assert.match(js, /setCoinField\('#coin-price', '—'\); appState\.setCoinField\('#coin-change', ''\);/);
  assert.doesNotMatch(js, /\['#coin-market-cap','#coin-price','#coin-change'/);
  const css = readFileSync(new URL('../styles/clarity.css', import.meta.url), 'utf8');
  assert.match(css, /\.coin-price-line \.coin-change:empty \{ display: none; \}/);
});
