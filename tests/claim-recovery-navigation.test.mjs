import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readAppSource();
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from);
  return app.slice(from, to);
}

test('successful launch opens its token, while invalid launch data cannot navigate', () => {
  const visits = [];
  const context = {
    location: { assign: path => visits.push(path) },
    validateSolanaMint: mint => ({ valid: mint === 'verified-mint' }),
  };
  vm.runInNewContext(section('function openLaunchedCoinPage(', 'let airdropRequestInFlight'), context);
  context.openLaunchedCoinPage({ mint: 'verified-mint' });
  assert.deepEqual(visits, ['/token/verified-mint']);
  context.openLaunchedCoinPage({ mint: 'invalid' });
  assert.deepEqual(visits, ['/token/verified-mint']);
});

test('creator fee dashboard remains available for verified V3 collection actions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="coin-fee-dashboard"/);
  assert.match(app, /function requestV3FeeAction\(/);
  assert.doesNotMatch(app, /function requestCreatorFeeClaim\(/);
});
