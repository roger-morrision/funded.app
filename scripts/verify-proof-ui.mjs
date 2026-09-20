import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

assert.match(html, /id="capital-flow"/);
assert.match(html, /id="fee-flow-input"/);
const docsLinks = html.match(/<article class="support-card docs-index">[\s\S]*?<\/article>/)?.[0] || '';
assert.match(docsLinks, /href="#privacy">Wallet safety/);
assert.match(docsLinks, /href="#terms" data-info="terms">Terms of Use/);
assert.match(docsLinks, /href="#disclosures" data-info="disclosures">Disclosures/);
assert.match(app, /\[data-info\].*openInfoDialog\(link\.dataset\.info\)/);
assert.match(app, /payment-dialog-list'\)\.innerHTML = payments\.length[\s\S]*?No verified payout receipts are available on Devnet yet/);
assert.match(html, /id="leaderboard-wallet-badge">Wallet required/);
assert.match(html, /id="leaderboard-wallet-title">Connect to see your rank/);
assert.match(app, /leaderboardBadge\.textContent = connected \? 'Indexer pending' : 'Wallet required'/);
assert.match(app, /leaderboardTitle\.textContent = connected \? 'Rank unavailable until activity is indexed' : 'Connect to see your rank'/);
assert.match(html, /Top traders<\/button>.*Top referrers<\/button>[\s\S]*?Category and time filters are unavailable until verified Devnet rankings are indexed/);
assert.match(html, /disabled title="Trader rankings require the verified activity indexer\."/);
assert.match(html, /disabled title="Time-window rankings require the verified activity indexer\."/);
assert.match(html, /Example ranking layout/);
assert.match(html, /View Devnet status →/);
assert.match(app, /secondary: \['View Devnet status', '#docs'\]/);
assert.doesNotMatch(html, /How ranking works/);
assert.doesNotMatch(html, /Public proof center|proof-ledger|data-proof-filter=/);
assert.match(html, /Every collected claim/);
assert.match(html, /Example outcome from every 1 SOL claimed/);
assert.match(app, /function renderFeeFlowCalculator\(/);
assert.match(app, /APP_ECONOMICS\.creatorSharePercent/);
assert.match(app, /APP_ECONOMICS\.appReferralEffectivePercent/);
assert.match(app, /APP_ECONOMICS\.buybackEffectivePercent/);
assert.match(css, /\.proof-status-bar/);
assert.match(css, /\.fee-output-grid/);

const productSource = `${html}\n${app}\n${css}`;
assert.doesNotMatch(productSource, /UsePaid|usepaid\.app/i);
assert.doesNotMatch(html, /Systems nominal|Last sync 18s ago|Jordan Davis/);

console.log('proof-first UI checks passed');
