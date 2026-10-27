import { readAppSource } from './read-app-source.mjs';
import { readStylesheet } from './read-stylesheet.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { referralRatePresentation } from '../src/features/fees/referral-rate-copy.js';
import { createFollowingController as createFollowingFixture } from '../src/app/controllers/following.js';
import { escapeHtml as escapeFixtureHtml } from '../src/features/shared/display.js';

const [html, appEntry, css, pageCss, pageExperience, creatorSupport] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readAppSource(),
  readStylesheet(new URL('../styles.css', import.meta.url)),
  readStylesheet(new URL('../page-experience.css', import.meta.url)),
  readFile(new URL('../page-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../creator-support-ui.js', import.meta.url), 'utf8'),
]);
const app = appEntry + (await Promise.all(['home/kpi-view.js', 'home/onchain-view.js', 'home/launch-card-view.js', 'explore/asset-card-view.js', 'rewards/airdrop-view.js', 'leaderboard/board-view.js', 'fees/fee-flow-view.js'].map(path => readFile(new URL(`../src/features/${path}`, import.meta.url), 'utf8')))).join('\n');
const xClaimView = await readFile(new URL('../src/features/rewards/x-claim-view.js', import.meta.url), 'utf8');
const homeLaunchBoard = await readFile(new URL('../src/features/home/launch-board-view.js', import.meta.url), 'utf8');
const paymentReceiptView = await readFile(new URL('../src/features/payments/receipt-view.js', import.meta.url), 'utf8');
const portfolioCardView = await readFile(new URL('../src/features/portfolio/token-card-view.js', import.meta.url), 'utf8');
const launchReviewMarkup = await readFile(new URL('../launch-review-markup.js', import.meta.url), 'utf8');
const tradeReviewModel = await readFile(new URL('../trade-review-model.js', import.meta.url), 'utf8');
const coinSummaryModel = await readFile(new URL('../coin-summary-model.js', import.meta.url), 'utf8');

assert.match(html, /id="capital-flow"/);
assert.doesNotMatch(html, /id="coin-rpc-status"/, 'The removed token header confirmation badge must not be rendered.');
assert.match(html, /id="referral-claim-center"[\s\S]*?Connect your earning wallet[\s\S]*?Sign in to view your private referral payouts\.[\s\S]*?data-referral-connect/, 'Disconnected referral state must request a wallet without claiming verified absence of payouts.');
assert.match(html, /id="referral-ledger-list" hidden/, 'The payout ledger stays hidden before receipt verification.');
const referralSource = await readFile(new URL('../src/app/controllers/referrals.js', import.meta.url), 'utf8');
assert.match(referralSource, /if \(!history\)[\s\S]*?renderReferralLedgerEmpty\('Receipts unavailable', 'Payout receipts could not be loaded\./, 'Unavailable history must not become a verified empty payout state.');
assert.match(referralSource, /if \(!claims\.length\) appState\.renderReferralLedgerEmpty\('No payouts yet'/, 'Only a verified empty history may report no payouts.');
assert.match(await readFile(new URL('../src/features/fees/fee-flow-markup.js', import.meta.url), 'utf8'), /id="fee-flow-input"/);
assert.match(html, /Enter a gross fee amount to preview the policy split\. This example does not move funds\./, 'Capital-flow preview copy must distinguish a policy example from live activity.');
assert.match(html, /class="home-kpi-footer"[\s\S]*?<a href="#analytics-detail">Open analytics →<\/a>/, 'The home dashboard must link to the routed analytics page.');
assert.match(html, /Community airdrops claimed/, 'The home KPI must label confirmed token claims rather than unclaimed allocations.');
assert.match(app, /const airdropClaims = currentCommunityClaimSummary\(\)/, 'The home KPI must read the verified community claim summary.');
assert.match(app, /setHomeDashboardMetric\('airdrop', airdropClaims\.amount, airdropClaims\.note, airdropClaims\.state\)/, 'The home KPI must use claim evidence for its amount, note, and state.');
assert.match(coinSummaryModel, /check funding on Airdrops/, 'Token summaries must direct users to per-launch vault evidence instead of assuming the vault state.');
assert.doesNotMatch(coinSummaryModel, /vault funding unverified/, 'Token summaries do not own the per-launch vault verification state.');
const docsLinks = html.match(/<article class="support-card docs-index">[\s\S]*?<\/article>/)?.[0] || '';
assert.match(docsLinks, /href="#privacy">Wallet safety/);
assert.match(docsLinks, /href="#terms" data-info="terms">Terms of Use/);
assert.match(docsLinks, /href="#disclosures" data-info="disclosures">Disclosures/);
assert.match(app, /\[data-info\].*openInfoDialog\(link\.dataset\.info\)/);
assert.match(app, /Automatic creator and holder SOL delivery requires verified funding and an active healthy distribution worker/, 'The Devnet disclosure must state the worker prerequisite.');
assert.doesNotMatch(app, /can automatically settle configured creator and holder SOL rewards/, 'The Devnet disclosure must not imply payouts work while the worker is unhealthy.');
assert.match(paymentReceiptView, /const rangeConflict = presentPaymentHistoryDateRange\(document\);\s+const filtered = rangeConflict \? \[\] : filterPaymentHistory\(historyPayouts, filters\);[\s\S]*?for \(const receipt of filtered\)[\s\S]*?list\.append\(row\)/, 'Payment history must suppress rows for an invalid native range and render the original filtered finalized payouts for valid criteria.');
assert.match(paymentReceiptView, /const emptyMessages = \{[\s\S]*?complete:'No confirmed payments are available to show yet\.'/, 'Only the complete history state may use the confirmed-empty receipt message.');
assert.match(paymentReceiptView, /if \(!filtered\.length\) \{[\s\S]*?rangeConflict \? 'Correct the date range to view matching payments\.' : historyPayouts\.length \? noMatch : emptyMessages\[historyState\]/, 'Invalid date criteria need neutral correction guidance; otherwise preserve source coverage and genuine filtered no-match messages.');
assert.match(html, /id="leaderboard-panel" role="tabpanel" aria-labelledby="leaderboard-burners-tab"/, 'The active leaderboard panel must be associated with its selected tab.');
assert.match(html, /id="notifications-button" aria-label="Notifications">♧<\/button>/);
assert.doesNotMatch(html, /No verified notifications|Notification feed unavailable/, 'The page must not hard-code notification claims without a verified feed.');
assert.doesNotMatch(html, /Devnet launch flow ready|Fee estimate refreshed/);
assert.match(html, /id="leaderboard-burn-board-tab"[^>]*>Burn board<\/button>/, 'The project burn board must be available.');
assert.match(app, /leaderboardBadge\.textContent = connected \? 'Indexer pending' : 'Wallet required'/);
assert.match(app, /leaderboardTitle\.textContent = connected \? 'Rank unavailable until activity is indexed' : 'Connect to see your rank'/);
assert.match(app, /const creator = policy\?\.onchainVerified \? policy\.creatorWallet \|\| policy\.feePayer : null/, 'Leaderboard attribution requires a verified funded launch policy.');
assert.doesNotMatch(app, /creator: launchByMint\.get\(item\.address\)\?\.creatorWallet \|\| launchByMint\.get\(item\.address\)\?\.feePayer \|\| item\.creator/, 'Unregistered coins must not be credited as funded creator launches.');
assert.match(app, /verified = verified\.filter\(item => \{[\s\S]*?return policy\?\.onchainVerified && \(policy\.creatorWallet \|\| policy\.feePayer\)/, 'Analytics must count only creator-attributed, policy-backed funded launches.');
assert.match(app, /const fundedLaunchRecords = records\.filter\(item => \{[\s\S]*?return policy\?\.onchainVerified && \(policy\.creatorWallet \|\| policy\.feePayer\)/, 'Overview must not count unregistered mints as funded launches.');
assert.match(app, /verifiedLaunchPolicies = response\.data\.filter\(launch => launch\.onchainVerified[\s\S]*?&& \(launch\.creatorWallet \|\| launch\.feePayer\)\)/, 'Explore benefit badges must require a creator-attributed funded policy.');
assert.match(homeLaunchBoard, /function renderHomeLaunchBoard\([\s\S]*?const verified = assets\.filter\(item => verifiedLaunchPolicyForMint\(item\.address\)\)[\s\S]*?let visible = \[\.\.\.verified\]/, 'The Home launch board must exclude mints without a funded policy.');
assert.match(html, /<p class="eyebrow">Confirmed activity<\/p><h1 id="leaderboard-title">Leaderboard<\/h1>/, 'The leaderboard must label its evidence scope.');
assert.match(html, /id="leaderboard-burners-tab"[^>]*aria-selected="true"[^>]*>Burners<\/button>/, 'Verified wallet burn leaderboard tab should be selected.');
assert.doesNotMatch(app, /escapeHtml\(initials\(item\.wallet\)\)/, 'Wallet burn rows must not call an undefined avatar helper.');
assert.match(html, /id="leaderboard-creators-tab"[^>]*>Creators<\/button>/, 'Verified creator leaderboard tab should be available.');
assert.match(html, /id="leaderboard-traders-tab"[^>]*>Traders<\/button>/, 'The trader tab must expose its unavailable state.');
assert.match(app, /const unavailable = EXPLORE_CLUSTER !== 'devnet' \|\| verifiedLaunchPoliciesStatus !== 'ready' \|\| !exploreFeedAvailable/, 'Trader ranking must require the verified launch registry and trade feed.');
assert.match(app, /Verified trade activity could not be loaded\./, 'Trader ranking must explain when its evidence is unavailable.');
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
assert.match(portfolioCardView, /const volume = item \? launchCardVolumeUsd\(item, '24h'\) : '\$—'/, 'Portfolio volume must come from an observed market row.');
assert.match(portfolioCardView, /\['24h volume', volume\]/, 'Portfolio cards must label observed volume.');
assert.match(portfolioCardView, /portfolioHolderCount\(item\)/, 'Portfolio cards must show a verified holder count or an unavailable value.');
const watchlistRenderSource = app.match(/function renderWatchlist\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(watchlistRenderSource, 'Watchlist renderer must be present.');
const watchlistNodes = {
  '#watch-count': { textContent: '' },
  '#watchlist-empty': { hidden: false },
  '#watchlist-items': {
    isConnected:true, childNodes:[], querySelectorAll:()=>[],
    get children() { return this.childNodes; },
    get firstChild() { return this.childNodes[0] || null; },
    get innerHTML() { return this.childNodes.map(node=>node.outerHTML).join(''); },
    insertBefore(node,cursor) {
      const prior=this.childNodes.indexOf(node);
      if(prior>=0)this.childNodes.splice(prior,1);
      const index=cursor?this.childNodes.indexOf(cursor):this.childNodes.length;
      assert.ok(index>=0);
      this.childNodes.splice(index,0,node);node.parentElement=this;node.isConnected=true;
    },
  },
};
const watchlistItems=watchlistNodes['#watchlist-items'];
watchlistNodes['#community']={isConnected:true,hidden:false,getClientRects:()=>[{}],
  contains:node=>node===watchlistItems || node?.parentElement===watchlistItems};
// Initial-render DOM model only: browser cases own native focus and layout proof.
const watchlistDocument={
  activeElement:null,hidden:false,hasFocus:()=>false,
  querySelector:selector=>watchlistNodes[selector],querySelectorAll:()=>[],
  createElement(tag) {
    assert.equal(tag,'template');
    return {content:{firstElementChild:null},set innerHTML(markup) {
      this.content.firstElementChild={outerHTML:markup,isConnected:false,parentElement:null,
        contains:()=>false,get nextSibling() {
          const children=this.parentElement?.childNodes || [];
          return children[children.indexOf(this)+1] || null;
        },remove() {
          const children=this.parentElement?.childNodes || [],index=children.indexOf(this);
          if(index>=0)children.splice(index,1);this.isConnected=false;this.parentElement=null;
        }};
    }};
  },
};
const watchlistGlobals={document:watchlistDocument,location:{pathname:'/',search:'',hash:'#community'},
  getComputedStyle:()=>({visibility:'visible'})};
const priorWatchlistGlobals=Object.fromEntries(Object.keys(watchlistGlobals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
try {
  for(const [key,value] of Object.entries(watchlistGlobals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const controller=createFollowingFixture({
    watchlistSync:{identity:()=>null},getWatchlist:()=>['missing-mint'],assets:[],
    verifiedLaunchPolicyForMint:()=>null,portfolioTokenCardMarkup:()=>'VERIFIED CARD',
    escapeHtml:escapeFixtureHtml,shortAddress:value=>String(value).slice(0,5),
    loadVerifiedTokenLogos:()=>{},setWatchButtonState:()=>{},watchlistUnavailable:false,
    watchlistNotice:'',showWatchlistStatus:()=>{},getCoinMintAddress:()=>'',renderFollowedWallets:()=>{},
  });
  controller.renderWatchlist();
} finally {
  for(const [key,descriptor] of Object.entries(priorWatchlistGlobals)) {
    if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
}
assert.equal(watchlistNodes['#watch-count'].textContent, '1 favorite');
assert.equal(watchlistNodes['#watchlist-empty'].hidden, true);
assert.match(watchlistNodes['#watchlist-items'].innerHTML, /Token details unavailable[\s\S]*?data-remove-watch="missing-mint"/, 'A saved mint without verified data must remain removable.');
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
assert.match(portfolioCardView, /class="saved-token-row/, 'Portfolio and Favorites entries must share the current saved-token row.');
assert.match(app, /token-card-shell airdrop-directory-card/);
assert.match(html, /id="airdrop-selected-program"[^>]+hidden/, 'Airdrop policy detail must be hidden until a program is selected.');
assert.match(app, /const safeMint = escapeHtml\(program\.id\)[\s\S]*?data-directory-mint="\$\{safeMint\}"[\s\S]*?View claim status/, 'The airdrop details action must target a unique mint.');
assert.match(app, /function renderAirdropProgramDetail\(program, \{ preserveStatus = false, open = false \} = \{\}\)[\s\S]*?renderAirdropProgramDetailView\(program/, 'Airdrop details must delegate to the current verified-status view.');
assert.match(await readFile(new URL('../src/features/rewards/airdrop-view.js', import.meta.url), 'utf8'), /program\.vaultVerified[\s\S]*?Funding and wallet eligibility must be confirmed before claims can open/, 'Planned airdrops must disclose missing funding and eligibility prerequisites.');
assert.match(xClaimView, /function resetSolClaimStatus\(\{[\s\S]*?Sign a wallet message to verify and submit this claim/, 'V3 X claims must require wallet verification before submission.');
assert.match(app, /getElementById\(id\)\?\.addEventListener\('input', \(\) => \{ updateClaimBindingReview\(\); resetSolClaimStatus\(\); \}\)/, 'Changing claim identity fields must reset stale validation.');
assert.match(app, /event\.target\?\.id === 'claim-binding-agree'\) resetSolClaimStatus\(\)/, 'Changing claim wallet confirmation must reset stale validation.');
const airdropActions = await readFile(new URL('../src/app/startup/explore-filters-actions.js', import.meta.url), 'utf8');
assert.match(airdropActions, /const program = appState\.getAirdropPrograms\(\)\.find\(item => item\.id === button\.dataset\.directoryMint\);[\s\S]*?openAirdropDetail\(program\)/, 'The selected mint must open its details rather than only filter the directory.');
assert.match(airdropActions, /function openAirdropDetail\(program\)[\s\S]*?appState\.renderAirdropProgramDetail\(program, \{ open:true \}\)/, 'Opening the selected mint must render its program details.');
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
assert.match(html, /<h1 id="favorites-title">Favorite tokens<\/h1>/);
assert.match(html, /<h2>All airdrops<\/h2>/);
const airdropDirectory = await readFile(new URL('../src/app/controllers/airdrop-directory.js', import.meta.url), 'utf8');
assert.match(airdropDirectory, /const claimsKnown = appState\.communityReserveStatus === 'ready' && programs\.every\(item => item\.claimVerification === 'verified'\)/, 'Funded counts require verified reserve evidence for every program.');
assert.match(airdropDirectory, /const fundingNote = claimsKnown[\s\S]*?'Funding verification unavailable or incomplete'[\s\S]*?<span>Planned tokens<\/span>/, 'Planned token amounts must disclose unavailable funding verification.');
assert.match(html, /id="airdrop-export-csv" disabled title="Requires an indexed, verified list of unclaimed wallets"/, 'Airdrop CSV export must be gated on verified wallet rows, not a snapshot count alone.');
assert.match(app, /getVerifiedUnclaimedWallets\(\)\{[\s\S]*?snapshotVerified === true/, 'Only verified snapshot wallets can enter the export.');
assert.match(app, /if \(exportButton\) exportButton\.disabled = verifiedWallets\.length === 0/, 'Export control must follow verified wallet availability.');
assert.match(app, /if \(!verifiedWallets\.length\) \{[\s\S]*?No verified eligibility snapshot or unclaimed wallets are available to export/, 'Direct export calls must fail closed without verified wallets.');
assert.match(app, /profileConnect\.textContent = connected \? 'View wallet details' : 'Connect wallet'/, 'Connected profile action must describe wallet details, not reconnection.');
assert.match(app, /#profile-connect'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*?if \(connectedWalletAddress\) document\.querySelector\('#profile-dialog'\)\?\.showModal\(\)/, 'Connected profile action must open wallet details.');
const walletConnectSource = await readFile(new URL('../src/app/controllers/wallet-connect.js', import.meta.url), 'utf8');
assert.match(walletConnectSource, /async function connectWallet\(\{ interactiveSignIn = true \} = \{\}\)\{[\s\S]*?if \(appState\.APP_MAINNET_READ_ONLY\) \{[\s\S]*?return;[\s\S]*?if \(!appState\.getProvider\(\) && appState\.DEV_MODE && appState\.DEV_WALLET_AUTOCONNECT\) \{[\s\S]*?appState\.allowWalletReconnect\(\);[\s\S]*?if \(await appState\.connectDevWallet\(\)\) return;/, 'Read-only mode must block signing; explicit Dev Mode reconnect may restore only the disposable wallet.');
assert.match(html, /id="trade-review-dialog"[\s\S]*?id="trade-review-confirm"/, 'Trade submission must have an explicit review dialog.');
assert.match(app, /#trade-submit'\)\?\.addEventListener\('click', openTradeReview\)/, 'Review and sign must not immediately submit a trade.');
assert.match(launchReviewMarkup, /id="launch-review-dialog"[\s\S]*?id="launch-review-confirm"/, 'Launch submission must have an explicit review dialog.');
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
assert.match(html, /Level 1 · Direct[\s\S]*?<strong>0\.6%<\/strong>[\s\S]*?Level 2 · Network[\s\S]*?<strong>0\.25%<\/strong>[\s\S]*?Level 3 · Extended[\s\S]*?<strong>0\.15%<\/strong>/, 'The home guide must show the approved pending three-level rates.');
const referralRates = referralRatePresentation();
assert.equal(referralRates.pending, true, 'Agency activation must remain pending in the shipped policy.');
assert.deepEqual(referralRates.levels.map(level => level.rate), [0.6, 0.25, 0.15]);
assert.match(referralRates.scopeDetail, /published deployment uses L1 2% \/ L2 0\.6% \/ L3 0\.4%/, 'Pending presentation must distinguish current deployed rates from approved future rates.');
assert.match(await readFile(new URL('../src/features/fees/fee-flow-view.js', import.meta.url), 'utf8'), /setAll\('\.home-referral-levels article strong', displayGross\.map\(percent\)\)/, 'The rendered home guide must take its rates from the policy presenter.');
assert.match(html, /class="home-referral-link-box"[\s\S]*?data-referral-link[\s\S]*?data-copy-referral-link/, 'The home referral guide must reuse the live referral link and copy behavior.');
assert.match(pageCss, /Home referral guide: explain the published three-level benefit/);
const coinPageMarkup = html.slice(html.indexOf('<section class="coin-page"'), html.indexOf('<section class="wallet-page"'));
assert.doesNotMatch(coinPageMarkup, /data-automatic-rewards|Coin reward distribution schedule/, 'Token detail pages must not render the automatic reward schedule panel.');
assert.match(html, /<section data-automatic-rewards aria-label="Reward distribution schedule"><\/section>/, 'The Home reward schedule must remain available.');

const productSource = `${html}\n${app}\n${css}`;
assert.doesNotMatch(productSource, /UsePaid|usepaid\.app/i);
assert.doesNotMatch(html, /Systems nominal|Last sync 18s ago|Jordan Davis/);

console.log('proof-first UI checks passed');
