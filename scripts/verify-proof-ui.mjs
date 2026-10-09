import { readStylesheet } from './read-stylesheet.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, appEntry, css, pageCss, pageExperience, creatorSupport] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readStylesheet(new URL('../styles.css', import.meta.url)),
  readStylesheet(new URL('../page-experience.css', import.meta.url)),
  readFile(new URL('../page-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../creator-support-ui.js', import.meta.url), 'utf8'),
]);
const app = appEntry + (await Promise.all(['home/kpi-view.js', 'home/onchain-view.js', 'rewards/airdrop-view.js'].map(path => readFile(new URL(`../src/features/${path}`, import.meta.url), 'utf8')))).join('\n');
const tradeReviewModel = await readFile(new URL('../trade-review-model.js', import.meta.url), 'utf8');
const coinSummaryModel = await readFile(new URL('../coin-summary-model.js', import.meta.url), 'utf8');

assert.match(html, /id="capital-flow"/);
assert.match(app, /setCoinField\('\.coin-live-dot', graduatedPool \? 'Trading pool confirmed' : curve \? 'Trading route confirmed' : 'Token confirmed'\)/, 'The token badge must scope confirmation to mint and market accounts, not unavailable trade or fee data.');
assert.match(html, /id="referral-ledger-list"><div class="empty-state referral-empty-state"><strong>No receipts to show<\/strong><small>Connect your wallet to check finalized referral claims\.<\/small><\/div>/, 'Disconnected referral history must not imply verified absence of claims.');
assert.match(html, /id="fee-flow-input"/);
assert.match(html, /Enter a gross fee amount to preview the policy split\. This example does not move funds\./, 'Capital-flow preview copy must distinguish a policy example from live activity.');
assert.match(html, /class="home-kpi-footer"[\s\S]*?<a href="#analytics-detail">Open analytics →<\/a>/, 'The home dashboard must link to the routed analytics page.');
assert.match(html, /Community airdrop allocations/, 'The home KPI must identify allocations without presenting them as a funded reserve.');
assert.match(app, /policy allocation\$\{reservePrograms\.length === 1 \? '' : 's'\} valued at spot · check vault funding per launch/, 'The home KPI must direct users to per-launch vault status without falsely marking every vault unverified.');
assert.match(app, /airdropUnit\.textContent = airdropAvailable \? 'USD' : 'ALLOCATIONS'/, 'The dashboard must identify unpriced community reserves as policy allocations rather than funded USD value.');
assert.match(coinSummaryModel, /check funding on Airdrops/, 'Token summaries must direct users to per-launch vault evidence instead of assuming the vault state.');
assert.doesNotMatch(coinSummaryModel, /vault funding unverified/, 'Token summaries do not own the per-launch vault verification state.');
const docsLinks = html.match(/<article class="support-card docs-index">[\s\S]*?<\/article>/)?.[0] || '';
assert.match(docsLinks, /href="#privacy">Wallet safety/);
assert.match(docsLinks, /href="#terms" data-info="terms">Terms of Use/);
assert.match(docsLinks, /href="#disclosures" data-info="disclosures">Disclosures/);
assert.match(app, /\[data-info\].*openInfoDialog\(link\.dataset\.info\)/);
assert.match(app, /Automatic creator and holder SOL delivery requires verified funding and an active healthy distribution worker/, 'The Devnet disclosure must state the worker prerequisite.');
assert.doesNotMatch(app, /can automatically settle configured creator and holder SOL rewards/, 'The Devnet disclosure must not imply payouts work while the worker is unhealthy.');
assert.match(app, /for \(const \[index, receipt\] of historyPayouts\.entries\(\)\)[\s\S]*?tape\.append\(row\)/, 'The payment dialog must render finalized payout rows.');
assert.match(app, /if \(!historyPayouts\.length\)[\s\S]*?tape\.innerHTML = '<p class="empty-state">No confirmed payments are available to show yet\.<\/p>'/, 'The payment dialog must explain when confirmed payment receipts are absent.');
assert.match(html, /id="leaderboard-panel" role="tabpanel" aria-labelledby="leaderboard-burners-tab"/, 'The active leaderboard panel must be associated with its selected tab.');
assert.match(html, /id="notifications-button" aria-label="Notifications">♧<\/button>/);
assert.match(html, /<h2>No verified notifications<\/h2>[\s\S]*?Notification feed unavailable/);
assert.doesNotMatch(html, /Devnet launch flow ready|Fee estimate refreshed/);
assert.match(html, /id="leaderboard-burn-board-tab"[^>]*>Burn board<\/button>/, 'The project burn board must be available.');
assert.match(app, /leaderboardBadge\.textContent = connected \? 'Indexer pending' : 'Wallet required'/);
assert.match(app, /leaderboardTitle\.textContent = connected \? 'Rank unavailable until activity is indexed' : 'Connect to see your rank'/);
assert.match(app, /const creator = policy\?\.onchainVerified \? policy\.creatorWallet \|\| policy\.feePayer : null/, 'Leaderboard attribution requires a verified funded launch policy.');
assert.doesNotMatch(app, /creator: launchByMint\.get\(item\.address\)\?\.creatorWallet \|\| launchByMint\.get\(item\.address\)\?\.feePayer \|\| item\.creator/, 'Unregistered coins must not be credited as funded creator launches.');
assert.match(app, /verified = verified\.filter\(item => \{[\s\S]*?return policy\?\.onchainVerified && \(policy\.creatorWallet \|\| policy\.feePayer\)/, 'Analytics must count only creator-attributed, policy-backed funded launches.');
assert.match(app, /const fundedLaunchRecords = records\.filter\(item => \{[\s\S]*?return policy\?\.onchainVerified && \(policy\.creatorWallet \|\| policy\.feePayer\)/, 'Overview must not count unregistered mints as funded launches.');
assert.match(app, /verifiedLaunchPolicies = response\.data\.filter\(launch => launch\.onchainVerified[\s\S]*?&& \(launch\.creatorWallet \|\| launch\.feePayer\)\)/, 'Explore benefit badges must require a creator-attributed funded policy.');
assert.match(app, /function renderHomeLaunchBoard\(\)\{[\s\S]*?const verified = assets\.filter\(item => verifiedLaunchPolicyForMint\(item\.address\)\)[\s\S]*?let visible = \[\.\.\.verified\]/, 'The Home launch board must exclude mints without a funded policy.');
assert.match(html, /<p class="eyebrow">Confirmed activity<\/p><h1 id="leaderboard-title">LEADERBOARDS<\/h1>/, 'The leaderboard must label its evidence scope.');
assert.match(html, /id="leaderboard-burners-tab"[^>]*aria-selected="true"[^>]*>Burners<\/button>/, 'Verified wallet burn leaderboard tab should be selected.');
assert.doesNotMatch(app, /escapeHtml\(initials\(item\.wallet\)\)/, 'Wallet burn rows must not call an undefined avatar helper.');
assert.match(html, /id="leaderboard-creators-tab"[^>]*>Creators<\/button>/, 'Verified creator leaderboard tab should be available.');
assert.match(html, /id="leaderboard-traders-tab"[^>]*>Traders<\/button>/, 'The trader tab must expose its unavailable state.');
assert.match(app, /Unavailable: the verified wallet activity index is not running/, 'Trader ranking must explain its missing index.');
assert.match(html, /disabled title="Rankings use all available verified activity\."/);
assert.match(html, /Verified \$FUNDED burns/);
assert.match(app, /Ranked from confirmed launch policies and available market caps/, 'Creator ranking must describe its verified inputs and market-cap order.');
assert.match(app, /View Solana status →/);
assert.match(app, /leaderboardLink\.href = connected \? '#docs' : '#profile'/, 'The leaderboard status action must route connected wallets to status and disconnected wallets to setup.');
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
assert.match(app, /const freshness = tokenCardEvidenceLabel\(cardData\)/, 'Portfolio cards must label data evidence separately from launch age.');
assert.match(app, /portfolio-token-stats/);
assert.match(app, /const volume = market \? formatExploreUsd\(market\.volume24hSol/, 'Portfolio volume must come from the observed market feed.');
assert.match(app, /\['24h volume', volume\]/, 'Migrated portfolio cards must show available observed volume.');
assert.match(app, /source: 'Saved token · market data checked'/, 'A verified market row must identify its checked market data.');
assert.match(app, /source: 'Saved token · launch confirmed'/, 'A registry-only row must identify its confirmed launch source.');
const watchlistRenderSource = app.match(/function renderWatchlist\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(watchlistRenderSource, 'Watchlist renderer must be present.');
const watchlistNodes = {
  '#watch-count': { textContent: '' },
  '#watchlist-empty': { hidden: false },
  '#watchlist-items': { innerHTML: '', querySelectorAll: () => [] },
};
const renderWatchlistFixture = new Function('document', 'getWatchlist', 'assets', 'verifiedLaunchPolicyForMint', 'portfolioTokenCardMarkup', 'escapeHtml', 'shortAddress', 'loadPortfolioLogo', 'setWatchButtonState', 'watchlistUnavailable', 'watchlistNotice', 'showWatchlistStatus',
  `${watchlistRenderSource}; return renderWatchlist;`);
const renderUnavailableWatchlist = renderWatchlistFixture(
  { querySelector: selector => watchlistNodes[selector], querySelectorAll: () => [] },
  () => ['missing-mint'], [], () => null, () => 'VERIFIED CARD', value => String(value), value => String(value).slice(0, 5), () => {}, () => {},
  false, '', () => {},
);
renderUnavailableWatchlist();
assert.equal(watchlistNodes['#watch-count'].textContent, '1 saved');
assert.equal(watchlistNodes['#watchlist-empty'].hidden, true);
assert.match(watchlistNodes['#watchlist-items'].innerHTML, /Saved token · details unavailable[\s\S]*?data-remove-watch="missing-mint"/, 'A saved mint without verified data must remain removable.');
const portfolioHolderSource = app.match(/function portfolioHolderCount\(asset\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(portfolioHolderSource, 'Watchlist and portfolio must format verified holder wallet counts.');
const holderCache = new Map([['mint', { count: 1, coverage: 'complete-account-list', at: Date.now() }]]);
const portfolioHolderCount = new Function('homeHolderCountCache', `${portfolioHolderSource}; return portfolioHolderCount;`)(holderCache);
assert.equal(portfolioHolderCount({ address: 'mint' }), '1', 'A fresh confirmed Home wallet sample must carry through to Community.');
assert.equal(portfolioHolderCount({ address: 'mint', holderWalletCount: 2 }), '2', 'Direct verified wallet counts take precedence over cached samples.');
holderCache.set('mint', { count: 1, coverage: 'complete-account-list', at: Date.now() - 300_001 });
assert.equal(portfolioHolderCount({ address: 'mint' }), '—', 'Expired wallet samples must not be presented as fresh.');
assert.match(app, /token-card-shell home-launch-card/);
assert.match(app, /token-card-shell asset-card/);
assert.match(app, /token-card-shell portfolio-token-card/);
assert.match(app, /token-card-shell airdrop-directory-card/);
assert.match(html, /id="airdrop-selected-program"[^>]+hidden/, 'Airdrop policy detail must be hidden until a program is selected.');
assert.match(app, /const safeMint = escapeHtml\(program\.id\)[\s\S]*?data-directory-mint="\$\{safeMint\}"[\s\S]*?View claim status/, 'The airdrop details action must target a unique mint.');
assert.match(app, /function renderAirdropProgramDetail\(program\)[\s\S]*?Funding and wallet eligibility must be confirmed before claims can open/, 'Airdrop details must disclose missing claim prerequisites.');
assert.match(app, /function resetSolClaimStatus\(\)[\s\S]*?Sign in with X to see your rewards\./, 'Editing a SOL claim must clear stale validation status.');
assert.match(app, /getElementById\(id\)\?\.addEventListener\('input', \(\) => \{ updateClaimBindingReview\(\); resetSolClaimStatus\(\); \}\)/, 'Changing claim identity fields must reset stale validation.');
assert.match(app, /event\.target\?\.id === 'claim-binding-agree'\) resetSolClaimStatus\(\)/, 'Changing claim wallet confirmation must reset stale validation.');
assert.match(app, /const program = getAirdropPrograms\(\)\.find\(item => item\.id === button\.dataset\.directoryMint\);[\s\S]*?renderAirdropProgramDetail\(program\)/, 'The details action must render program details, not only filter the directory.');
assert.doesNotMatch(app, /selected — checking eligibility for your connected wallet/, 'Selecting an airdrop must not imply a wallet check that did not run.');
assert.match(pageCss, /One professional card surface is shared by Home, Explore, portfolios, watchlists, and rewards/);
assert.match(pageCss, /\.analytics-kpis\.analytics-kpis-complete/);
assert.match(app, /Explore launches, fees, payments, trades, airdrops, referrals, and burns/);
assert.match(app, /This preview never moves funds/);
assert.match(pageExperience, /function upgradeAnalyticsDashboard\(/);
assert.match(pageExperience, /Funded at a glance/);
assert.match(pageExperience, /A user-initiated \$FUNDED burn requires a configured Solana mint[\s\S]*?check Buy & burn for current availability/, 'The $FUNDED status must not claim a burn is available when its mint is unconfigured.');
assert.match(app, /creatorRankingUnavailable = verifiedLaunchPoliciesStatus !== 'ready' \|\| !exploreFeedAvailable/, 'Creator leaderboard must treat an unavailable registry or market feed as unavailable, not empty.');
assert.match(pageExperience, /data-analytics-metric="burned"/);
assert.match(html, /<h2>Saved tokens<\/h2>/);
assert.match(html, /<h2>All airdrops<\/h2>/);
assert.match(app, /communityReserveStatus === 'ready'[\s\S]*?Funding status unavailable[\s\S]*?<span>Planned tokens<\/span>/, 'Indexed policy allocations must report funded counts only when reserve evidence is ready.');
assert.match(html, /id="airdrop-export-csv" disabled title="Requires an indexed, verified list of unclaimed wallets"/, 'Airdrop CSV export must be gated on verified wallet rows, not a snapshot count alone.');
assert.match(app, /getVerifiedUnclaimedWallets\(\)\{[\s\S]*?snapshotVerified === true/, 'Only verified snapshot wallets can enter the export.');
assert.match(app, /if \(exportButton\) exportButton\.disabled = verifiedWallets\.length === 0/, 'Export control must follow verified wallet availability.');
assert.match(app, /if \(!verifiedWallets\.length\) \{[\s\S]*?No verified eligibility snapshot or unclaimed wallets are available to export/, 'Direct export calls must fail closed without verified wallets.');
assert.match(app, /profileConnect\.textContent = connected \? 'View wallet details' : 'Connect wallet'/, 'Connected profile action must describe wallet details, not reconnection.');
assert.match(app, /#profile-connect'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*?if \(connectedWalletAddress\) document\.querySelector\('#profile-dialog'\)\?\.showModal\(\)/, 'Connected profile action must open wallet details.');
assert.match(app, /async function connectWallet\(\)\{[\s\S]*?if \(!getProvider\(\) && DEV_MODE && DEV_WALLET_AUTOCONNECT\) \{[\s\S]*?allowWalletReconnect\(\);[\s\S]*?if \(await connectDevWallet\(\)\) return;/, 'An explicit reconnect must restore the disposable Dev Mode wallet after manual disconnect.');
assert.match(html, /id="trade-review-dialog"[\s\S]*?id="trade-review-confirm"/, 'Trade submission must have an explicit review dialog.');
assert.match(app, /#trade-submit'\)\?\.addEventListener\('click', openTradeReview\)/, 'Review and sign must not immediately submit a trade.');
assert.match(html, /id="launch-review-dialog"[\s\S]*?id="launch-review-confirm"/, 'Launch submission must have an explicit review dialog.');
assert.match(app, /function handleLaunchAction\(event\)[\s\S]*?openLaunchReview\(\);/, 'The launch action must open review before submitting.');
assert.match(app, /function confirmLaunchReview\(\)[\s\S]*?launchReviewStillCurrent\(pending, currentLaunchReviewState\(\)\)[\s\S]*?void launchToken\(\)/, 'Only a fresh, unchanged launch review can start signing.');
assert.match(app, /function openTradeReview\(\)[\s\S]*?Date\.now\(\) - tradePreview\.preparedAt > 15_000/, 'Trade review must reject expired quotes.');
assert.match(app, /Maximum pool spend:.*quote\.maximumSpendSol\.toFixed\(9\)/, 'Graduated-pool preview must disclose maximum SOL spend.');
assert.match(app, /const review = buildTradeReview\(\{ trade:prepared\.trade/, 'Trade review must use the prepared quote.');
assert.match(tradeReviewModel, /limitLabel:'Maximum trade \+ app fee', limitAmount:sol\(maximumSpend \+ fee\)/, 'Graduated-pool review must disclose maximum SOL spend and app fee.');
assert.match(app, /Maximum pool spend includes Pump pool fees/, 'Graduated-pool review must not double-count Pump fees.');
assert.match(html, /<p class="nav-label">Workspace<\/p>/);
assert.match(html, /<details class="nav-more"><summary>More/);
assert.match(html, /class="nav-more-menu"[\s\S]*?href="#analytics-detail"[\s\S]*?href="#leaderboard"[\s\S]*?href="\/funded"/, 'The compact More menu must retain analytics, leaderboard, and $FUNDED navigation.');
assert.match(html, /id="desktop-sidebar-toggle"[^>]+aria-controls="sidebar"[^>]+aria-expanded="true"/);
assert.match(app, /funded\.desktop-sidebar-collapsed/);
assert.match(app, /setDesktopSidebarCollapsed\(!document\.documentElement\.classList\.contains\('sidebar-collapsed'\)\)/);
assert.match(pageCss, /html\.sidebar-collapsed \.sidebar/);
assert.doesNotMatch(creatorSupport, /More & transparency|support-more-nav|nav\.replaceChildren\(\.\.\.primary,more\)/);
assert.match(pageCss, /Keep the complete navigation visible and grouped/);
assert.match(html, /class="home-referral-guide section-block"[\s\S]*?One link\. Three levels of benefits\./, 'The home page must end with the three-level referral quick guide.');
assert.match(html, /Level 1 · Direct[\s\S]*?<strong>2%<\/strong>[\s\S]*?Level 2 · Network[\s\S]*?<strong>0\.6%<\/strong>[\s\S]*?Level 3 · Extended[\s\S]*?<strong>0\.4%<\/strong>/, 'The home referral guide must show the published three-level rates.');
assert.match(html, /class="home-referral-link-box"[\s\S]*?data-referral-link[\s\S]*?data-copy-referral-link/, 'The home referral guide must reuse the live referral link and copy behavior.');
assert.match(pageCss, /Home referral guide: explain the published three-level benefit/);
const coinPageMarkup = html.slice(html.indexOf('<section class="coin-page"'), html.indexOf('<section class="wallet-page"'));
assert.doesNotMatch(coinPageMarkup, /data-automatic-rewards|Coin reward distribution schedule/, 'Token detail pages must not render the automatic reward schedule panel.');
assert.match(html, /<section data-automatic-rewards aria-label="Reward distribution schedule"><\/section>/, 'The Home reward schedule must remain available.');

const productSource = `${html}\n${app}\n${css}`;
assert.doesNotMatch(productSource, /UsePaid|usepaid\.app/i);
assert.doesNotMatch(html, /Systems nominal|Last sync 18s ago|Jordan Davis/);

console.log('proof-first UI checks passed');
