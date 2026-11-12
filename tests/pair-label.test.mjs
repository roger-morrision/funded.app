import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCategory, WSOL_MINT } from '../server/routes/pair-quotes.mjs';
import { tokenPair, matchesPairFilter, pairChipMarkup } from '../src/features/shared/pair-label.js';

const escape = value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

test('quote tokens are grouped for the Paired-with filter', () => {
  assert.equal(quoteCategory({ mint: WSOL_MINT, symbol: 'SOL', name: 'Wrapped SOL' }), 'sol');
  assert.equal(quoteCategory({ mint: 'm1', symbol: 'USDC', name: 'USD Coin' }), 'stable');
  assert.equal(quoteCategory({ mint: 'm2', symbol: 'SPYx', name: 'SP500 xStock' }), 'xstocks');
  assert.equal(quoteCategory({ mint: 'm3', symbol: 'SPCX', name: 'SpaceX - Backpack Securities' }), 'stocks');
  assert.equal(quoteCategory({ mint: 'm4', symbol: 'HYPE', name: 'HYPE' }), 'crypto');
});

test('a token row names its pair and matches the filter', () => {
  assert.equal(tokenPair({}), null);
  assert.deepEqual(tokenPair({ quoteMint: WSOL_MINT }).symbol, 'SOL');
  const usdc = tokenPair({ quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', quoteSymbol: 'USDC' });
  assert.equal(usdc.category, 'stable');
  const custom = { quoteMint: '4CxjZyMNoF1p6eXHXHv1TWpS2X47CuUmLwtGe18spump', quoteSymbol: 'mihao' };
  assert.equal(tokenPair(custom).category, 'custom');
  assert.equal(matchesPairFilter(custom, 'custom'), true);
  assert.equal(matchesPairFilter(custom, 'sol'), false);
  assert.equal(matchesPairFilter({}, 'sol'), true, 'unknown pairs count as SOL, the Pump default');
  assert.equal(matchesPairFilter(custom, 'all'), true);
  assert.match(pairChipMarkup(custom, escape), /Paired with<\/small><b>mihao<\/b>/);
  assert.equal(pairChipMarkup({}, escape), '');
});
