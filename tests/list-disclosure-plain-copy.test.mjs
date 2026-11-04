import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Get listed disclosure uses plain words in markup and runtime copy', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../list-page.js', import.meta.url), 'utf8');
  assert.match(html, /id="list-burn-disclosure">Pay \$300 by burning \$FUNDED at the current pool price/);
  assert.match(js, /Pay \$\$\{LISTING_PRICE_USD\} by burning \$FUNDED at the current pool price/);
  for (const src of [html, js]) assert.doesNotMatch(src, /a wallet approval and verified receipt are required/);
});
