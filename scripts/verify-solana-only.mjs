import { readAppSource } from './read-app-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, readme] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readAppSource(),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

const productSource = `${html}\n${app}`;
const unsupportedUi = [
  /All networks/i,
  />\s*Base\s*</i,
  />\s*Ethereum\s*</i,
  /meta:\s*['"]BASE\b/i,
  /meta:\s*['"]ETHEREUM\b/i,
];

for (const pattern of unsupportedUi) {
  assert.doesNotMatch(productSource, pattern, `Unsupported chain UI remains: ${pattern}`);
}

assert.doesNotMatch(html, /Solana only/);
assert.match(html, /<p class="eyebrow">Create on Solana<\/p>/);
assert.match(html, /<span>Launchpad<\/span><strong id="preview-launchpad">Pump\.fun<\/strong>/);
assert.match(html, /<span>Launch tier<\/span><strong id="preview-burn-tier"/);
assert.match(app, /chain:\s*'solana'/);
assert.match(app, /cluster:\s*'devnet'/);
assert.match(app, /launchpad:\s*'pump'/);
assert.doesNotMatch(productSource, /launchpad:\s*['"](?!pump['"])/i);
assert.match(readme, /A Solana Devnet application for launching and discovering tokens/);
assert.match(readme, /Mainnet activation is a separate reviewed release\./, 'Documentation must not imply mainnet launch availability.');

console.log('solana-only product verification passed');
