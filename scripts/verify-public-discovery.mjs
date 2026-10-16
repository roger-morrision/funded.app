import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPageDelivery } from '../server/page-delivery.mjs';

const root = resolve(import.meta.dirname, '..');
const launch = (index, overrides = {}) => ({
  mint: `${'A'.repeat(31)}${index}`,
  cluster: 'devnet',
  creator: 'creator',
  name: index === 1 ? '<Unsafe & name>' : `Coin ${index}`,
  symbol: index === 1 ? 'A&B' : `C${index}`,
  onchainVerified: true,
  policySignature: 'signed',
  createdTimestamp: index,
  pumpFeeRoute: { scope: 'per-mint-v3', verified: true, router: 'creator', programId: 'program' },
  ...overrides,
});
const launches = Array.from({ length: 8 }, (_, index) => launch(index + 1)).concat([
  launch(9, { onchainVerified: false }),
  launch(9, { cluster: 'mainnet-beta' }),
  launch(9, { pumpFeeRoute: { scope: 'legacy', verified: true } }),
]);

async function render(pathname, readLaunches) {
  let status;
  let headers;
  let body;
  const response = {
    writeHead(code, nextHeaders) { status = code; headers = nextHeaders; },
    end(content) { body = String(content); },
  };
  const delivery = createPageDelivery({ staticRoot: root, store: { readLaunches }, solanaCluster: 'devnet', respond() { throw new Error('Unexpected JSON response'); } });
  assert.equal(await delivery.handlePages({ method: 'GET' }, response, new URL(`https://funded.vip${pathname}`)), true);
  assert.equal(status, 200);
  assert.equal(headers['content-type'], 'text/html; charset=utf-8');
  return body;
}

for (const path of ['/', '/explore']) {
  const html = await render(path, async () => launches);
  const section = html.match(/<section class="public-discovery"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.match(section, /Explore Solana coins/);
  assert.equal((section.match(/<li><a href="\/token\//g) || []).length, 6);
  assert.match(section, /<strong>Coin 8<\/strong>/);
  assert.doesNotMatch(section, /<strong>&lt;Unsafe/);
  assert.doesNotMatch(section, /\/token\/[A]+9/);
  assert.doesNotMatch(section, /Checking verified launches/);
}
const escaped = await render('/', async () => [launch(1)]);
assert.match(escaped, /&lt;Unsafe &amp; name&gt;/);
assert.match(escaped, /A&amp;B/);
assert.doesNotMatch(escaped, /<Unsafe/);
assert.match(await render('/', async () => []), /No verified launches to show right now/);
assert.match(await render('/', async () => { throw new Error('database offline'); }), /Launch directory is temporarily unavailable/);

const styles = await readFile(resolve(root, 'styles/home/base-navigation.css'), 'utf8');
assert.match(styles, /section:not\(\.hero-section\):not\(\.public-discovery\)/);
console.log('Public discovery: page rendering, verified links, escaping, empty state, and unavailable state passed.');
