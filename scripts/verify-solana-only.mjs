import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, readme] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
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
assert.match(html, /aria-label="Solana launch route"/);
assert.match(app, /chain:\s*'solana'/);
assert.match(app, /cluster:\s*'devnet'/);
assert.match(app, /launchpad:\s*'pump'/);
assert.doesNotMatch(productSource, /launchpad:\s*['"](?!pump['"])/i);
assert.match(readme, /Solana-only market dashboard/);

console.log('solana-only product verification passed');
