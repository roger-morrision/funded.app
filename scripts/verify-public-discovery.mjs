import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPageDelivery } from '../server/page-delivery.mjs';
import { publicDiscoveryHtml } from '../server/public-discovery.mjs';

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
  for (const read of [async () => launches, async () => [], async () => { throw new Error('database offline'); }]) {
    const html = await render(path, read);
    assert.doesNotMatch(html, /id="public-discovery"|class="public-discovery|public-discovery-items:/);
    assert.doesNotMatch(html, /Verified launch directory|Explore Solana coins|Browse all launches/);
    assert.match(html, /class="home-launch-board"/);
    assert.equal(publicDiscoveryHtml(html, launches, 'devnet'), html, 'Removed markers cannot reinject a section');
  }
}
// Explicit helper fixtures preserve filtering/escaping negative controls. They
// are not page-delivery presence claims after the human-requested removal.
const fixture = '<section><!-- public-discovery-items:start -->Checking verified launches<!-- public-discovery-items:end --></section>';
const filtered = publicDiscoveryHtml(fixture, launches, 'devnet');
assert.equal((filtered.match(/<li><a href="\/token\//g) || []).length, 6);
assert.match(filtered, /<strong>Coin 8<\/strong>/);
assert.doesNotMatch(filtered, /<strong>&lt;Unsafe/);
assert.doesNotMatch(filtered, /\/token\/[A]+9/);
assert.doesNotMatch(filtered, /Checking verified launches/);
const escaped = publicDiscoveryHtml(fixture, [launch(1)], 'devnet');
assert.match(escaped, /&lt;Unsafe &amp; name&gt;/);
assert.match(escaped, /A&amp;B/);
assert.doesNotMatch(escaped, /<Unsafe/);
assert.match(publicDiscoveryHtml(fixture, [], 'devnet'), /No verified launches to show right now/);
assert.match(publicDiscoveryHtml(fixture, null, 'devnet'), /Launch directory is temporarily unavailable/);

const styles = await readFile(resolve(root, 'styles/home/base-navigation.css'), 'utf8');
assert.match(styles, /section:not\(\.hero-section\):not\(\.public-discovery\)/);
console.log('Public discovery removal: root/explore absence for populated, empty and unavailable reads; isolated helper filtering, escaping and negative controls passed.');
