import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, css, pageCss, pageExperience, creatorSupport] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../page-experience.css', import.meta.url), 'utf8'),
  readFile(new URL('../page-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../creator-support-ui.js', import.meta.url), 'utf8'),
]);

assert.match(html, /id="capital-flow"/);
assert.match(html, /id="fee-flow-input"/);
assert.match(html, /class="home-kpi-footer"[\s\S]*?<a href="#analytics-detail">Open analytics →<\/a>/, 'The home dashboard must link to the routed analytics page.');
const docsLinks = html.match(/<article class="support-card docs-index">[\s\S]*?<\/article>/)?.[0] || '';
assert.match(docsLinks, /href="#privacy">Wallet safety/);
assert.match(docsLinks, /href="#terms" data-info="terms">Terms of Use/);
assert.match(docsLinks, /href="#disclosures" data-info="disclosures">Disclosures/);
assert.match(app, /\[data-info\].*openInfoDialog\(link\.dataset\.info\)/);
assert.match(app, /payment-dialog-list'\)\.innerHTML = payments\.length[\s\S]*?No verified payout receipts are available on Devnet yet/);
assert.match(html, /id="leaderboard-wallet-badge">Wallet required/);
assert.match(html, /id="notifications-button" aria-label="Notifications">♧<\/button>/);
assert.match(html, /<h2>No verified notifications<\/h2>[\s\S]*?Notification feed unavailable/);
assert.doesNotMatch(html, /Devnet launch flow ready|Fee estimate refreshed/);
assert.match(html, /id="leaderboard-wallet-title">Connect to see your rank/);
assert.match(app, /leaderboardBadge\.textContent = connected \? 'Indexer pending' : 'Wallet required'/);
assert.match(app, /leaderboardTitle\.textContent = connected \? 'Rank unavailable until activity is indexed' : 'Connect to see your rank'/);
assert.match(html, /Confirmed Devnet launches<\/p><h2>Top builders<\/h2>[\s\S]*?id="leaderboard-podium-badge">RPC verified<\/span>/);
assert.match(html, /disabled title="Creator launches require confirmed mint and Pump-curve RPC data\."/);
assert.match(html, /disabled title="Trader rankings require the verified activity indexer\."/);
assert.match(html, /disabled title="Time-window rankings require the verified activity indexer\."/);
assert.match(html, /Ranked by verified contribution/);
assert.match(app, /View Devnet status →/);
assert.match(app, /secondary: \['View Devnet status', '#docs'\]/);
assert.match(app, /Compare verified creator contribution after launch and trading activity has been confirmed/);
assert.doesNotMatch(app, /Awaiting verified indexer/, 'Verified analytics must not be overwritten after the initial RPC load resolves.');
assert.match(app, /function normalizeDirectPagePathForHashRoute\(\)/);
assert.match(app, /history\.replaceState\(\{\}, '', `\/\$\{location\.search\}\$\{location\.hash\}`\)/, 'Hash navigation from token and wallet detail pages must return to the canonical app path.');
assert.doesNotMatch(html, /Public proof center|proof-ledger|data-proof-filter=/);
assert.match(html, /Every creator-fee claim follows one accountable route/);
assert.match(html, /Example gross claim<\/span><strong>100 SOL<\/strong>/);
assert.match(html, /Policy example only · no funds move in preview/);
assert.match(app, /function renderFeeFlowCalculator\(/);
assert.match(app, /APP_ECONOMICS\.creatorSharePercent/);
assert.match(app, /APP_ECONOMICS\.appReferralEffectivePercent/);
assert.match(app, /APP_ECONOMICS\.buybackEffectivePercent/);
assert.match(css, /\.proof-status-bar/);
assert.match(css, /\.fee-output-grid/);
assert.match(pageCss, /Clean workspace pages: one compact intro/);
assert.match(pageCss, /\.page-route-community \.community-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
assert.match(app, /function portfolioTokenCardMarkup\(/);
assert.match(app, /portfolio-token-stats/);
assert.match(app, /Saved from Explore · RPC verified/);
assert.match(app, /token-card-shell home-launch-card/);
assert.match(app, /token-card-shell asset-card/);
assert.match(app, /token-card-shell portfolio-token-card/);
assert.match(app, /token-card-shell airdrop-directory-card/);
assert.match(pageCss, /One professional card surface is shared by Home, Explore, portfolios, watchlists, and rewards/);
assert.match(pageCss, /\.analytics-kpis\.analytics-kpis-complete/);
assert.match(app, /Review launches, fees, payouts, trading volume, airdrops, referrals, and burns/);
assert.match(app, /This preview never moves funds/);
assert.match(pageExperience, /function upgradeAnalyticsDashboard\(/);
assert.match(pageExperience, /Funded at a glance/);
assert.match(pageExperience, /data-analytics-metric="burned"/);
assert.match(html, /<h2>Saved launches<\/h2>/);
assert.match(html, /<h2>Airdrop programs<\/h2>/);
assert.match(html, /<p class="nav-label">Workspace<\/p>/);
assert.match(html, /<p class="nav-label nav-label-spaced">Build<\/p>/);
assert.match(html, /<p class="nav-label nav-label-spaced">Growth<\/p>/);
assert.match(html, /<p class="nav-label nav-label-spaced">Protocol<\/p>/);
assert.doesNotMatch(creatorSupport, /More & transparency|support-more-nav|nav\.replaceChildren\(\.\.\.primary,more\)/);
assert.match(pageCss, /Keep the complete navigation visible and grouped/);
assert.match(html, /class="home-referral-guide section-block"[\s\S]*?One link\. Three levels of benefits\./, 'The home page must end with the three-level referral quick guide.');
assert.match(html, /Level 1 · Direct[\s\S]*?<strong>2%<\/strong>[\s\S]*?Level 2 · Network[\s\S]*?<strong>0\.6%<\/strong>[\s\S]*?Level 3 · Extended[\s\S]*?<strong>0\.4%<\/strong>/, 'The home referral guide must show the published three-level rates.');
assert.match(html, /class="home-referral-link-box"[\s\S]*?data-referral-link[\s\S]*?data-copy-referral-link/, 'The home referral guide must reuse the live referral link and copy behavior.');
assert.match(pageCss, /Home referral guide: explain the published three-level benefit/);

const productSource = `${html}\n${app}\n${css}`;
assert.doesNotMatch(productSource, /UsePaid|usepaid\.app/i);
assert.doesNotMatch(html, /Systems nominal|Last sync 18s ago|Jordan Davis/);

console.log('proof-first UI checks passed');
