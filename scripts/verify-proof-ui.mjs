import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

assert.match(html, /id="capital-flow"/);
assert.match(html, /id="fee-flow-input"/);
assert.match(html, /id="proof-ledger"/);
assert.match(html, /data-proof-filter="route"/);
assert.match(html, /data-proof-filter="referral"/);
assert.match(html, /data-proof-filter="burn"/);
assert.match(html, /Every collected claim/);
assert.match(html, /Example outcome from every 1 SOL claimed/);
assert.match(app, /function renderFeeFlowCalculator\(/);
assert.match(app, /APP_ECONOMICS\.creatorSharePercent/);
assert.match(app, /APP_ECONOMICS\.appReferralEffectivePercent/);
assert.match(app, /APP_ECONOMICS\.buybackEffectivePercent/);
assert.match(css, /\.proof-status-bar/);
assert.match(css, /\.fee-output-grid/);
assert.match(css, /\.proof-ledger-row/);

const productSource = `${html}\n${app}\n${css}`;
assert.doesNotMatch(productSource, /UsePaid|usepaid\.app/i);
assert.doesNotMatch(html, /Systems nominal|Last sync 18s ago|Jordan Davis/);

console.log('proof-first UI checks passed');
