import { readAppSourceSync } from './read-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectRecentTrades, enrichMarketRecord, filterMarketRecords, summarizeMarkets, withMarketWindow } from '../market-intelligence.js';
import { explorePageNumbers, paginateExploreRows } from '../explore-pagination.js';
import { exploreSocialLinks } from '../explore-social-links.js';
import { formatSolMetric, readCurveMetrics, readPumpSwapMetrics } from '../explore-onchain-metrics.js';
import { sortDevnetLaunches } from '../server/explore-registry.mjs';

const exploreMarkup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appSource = ['../app.js', '../src/features/home/onchain-view.js', '../src/features/home/kpi-view.js', '../src/features/home/launch-board-view.js', '../src/features/explore/assets-view.js', '../src/features/explore/controls-view.js', '../src/features/explore/registry-view.js']
  .map(path => path === '../app.js' ? readAppSourceSync() : readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
const workspaceSource = readFileSync(new URL('../src/features/workspace/explore.js', import.meta.url), 'utf8');
assert.deepEqual(exploreSocialLinks({}, {}), [], 'Tokens without social links leave the icon group empty.');
assert.deepEqual(exploreSocialLinks({ website:'https://token.example', twitter:'javascript:alert(1)', telegram:'https://t.me/token' }, { x:'https://x.com/token', discord:'https://discord.gg/token' }).map(link => [link.label, link.href]), [
  ['Website', 'https://token.example/'],
  ['X', 'https://x.com/token'],
  ['Telegram', 'https://t.me/token'],
  ['Discord', 'https://discord.gg/token'],
], 'Explore shows available public links, rejects unsafe URLs, and uses verified launch links when needed.');
assert.match(appSource, /!feedChecked \? 'Checking launches' : marketUnavailable \? 'Launch activity unavailable'/, 'Unavailable launch feeds must not be described as zero confirmed launches.');
assert.match(appSource, /marketUnavailable \? '— <small>launch activity unavailable<\/small>'/, 'The analytics strip must distinguish unavailable registry data from a verified empty result.');
assert.match(appSource, /launchFeedUnavailable\s*\? 'Launch policies unavailable; allocation not verified'/, 'Analytics must not claim there are no community allocations when the launch registry is unavailable.');
assert.match(appSource, /recordedPayouts \? 'Recorded payouts are awaiting receipt verification' : 'USD quote or payout evidence unavailable'/, 'Analytics must not claim there are no referral payouts when receipt verification is unavailable.');
assert.match(appSource, /registryUnavailable \? outage\.title : `\$\{filtered\.length\} of \$\{registryLaunches\.length\} shown`/, 'Explore must explain the current outage instead of showing a verified zero result while its sources are unavailable.');
assert.match(appSource, /if \(exploreLoadInFlight\) return exploreLoadInFlight;[\s\S]*?exploreLoadInFlight = load;[\s\S]*?exploreLoadInFlight = null;/, 'Overlapping Explore refreshes must share one load instead of racing their scan counter.');
assert.match(appSource, /let scannedCount = 0;[\s\S]*?scannedCount \+= 1;[\s\S]*?exploreScannedCount = scannedCount;/, 'A completed Explore load must publish only its own scan count.');
assert.match(exploreMarkup, /Minimum market cap · USD\s*<input id="explore-min-cap-sol"/);
assert.match(exploreMarkup, /Minimum 24h volume · USD<\/span><input id="explore-min-volume-sol"/);
assert.match(exploreMarkup, /id="explore-promotion-filter"[\s\S]*?Any paid promotion[\s\S]*?Premier/);
assert.match(exploreMarkup, /role="table" aria-label="Verified launch table"[\s\S]*?<span role="columnheader">#<\/span><span role="columnheader">Coin<\/span><span role="columnheader">Tier<\/span><span role="columnheader">MC<\/span><span role="columnheader">Age<\/span>/, 'The index shows ranked coins with separate tier, market cap, and age columns.');
assert.match(appSource, /function refreshRegistryLaunches\(\)[\s\S]*?registryLaunches = assets\.filter[\s\S]*?\.map\(item => withVerifiedExploreBenefits\(/, 'Scanner filters use verified launch tier data.');
assert.match(appSource, /function exploreAirdropMarkup\(record\)[\s\S]*?\['funded', 'drop-active'\]\.includes\(reserve\.status\)[\s\S]*?const detail = active \? 'Claims open' : funded \? 'Upcoming' : 'Checking availability'/, 'The Explore airdrop cell must not label a verified active drop as unfunded.');
assert.match(workspaceSource, /aria-label', 'Verified launch tier filters'[\s\S]*?\['Standard', 'standard'\][\s\S]*?\['Premier', 'premier'\]/, 'The visible tier chips expose verified launch tiers.');
const rankedLaunches = Array.from({ length: 23 }, (_, index) => ({ address: `mint-${index + 1}` }));
const secondPage = paginateExploreRows(rankedLaunches, 2);
assert.deepEqual([secondPage.page, secondPage.pages, secondPage.start, secondPage.end, secondPage.rows[0].address], [2, 3, 10, 20, 'mint-11']);
assert.deepEqual(paginateExploreRows(rankedLaunches.slice(0, 3), 9).rows.map(item => item.address), ['mint-1', 'mint-2', 'mint-3'], 'A smaller filtered result clamps back to its last available page.');
assert.deepEqual(explorePageNumbers(7, 12), [5, 6, 7, 8, 9], 'Numbered paging keeps the active page centered when possible.');
assert.deepEqual(explorePageNumbers(12, 12), [8, 9, 10, 11, 12], 'Numbered paging ends at the last available page.');
assert.deepEqual(filterMarketRecords([
  { address: 'standard', promotionBurnTokens: 0 },
  { address: 'verified-boost', promotionBurnTokens: 100_000 },
  { address: 'unverified', promotionBurnTokens: null },
], { sort: 'tier-burn' }).map(item => item.address), ['verified-boost', 'standard', 'unverified'], 'Tier ranking uses the verified launch burn amount.');
assert.match(exploreMarkup, /id="scanner-trades-heading"[\s\S]*?id="scanner-volume-heading"[\s\S]*?<span role="columnheader">24h<\/span><span role="columnheader">Airdrop<\/span><span role="columnheader">Status<\/span><span role="columnheader">Boost<\/span>/, 'The index shows trading, airdrop, status, and boost in separate columns.');
assert.match(exploreMarkup, /id="explore-reward-filter"[\s\S]*?Community token airdrop[\s\S]*?Creator fees → holders[\s\S]*?Creator fees → X account/);
assert.match(exploreMarkup, /<option value="airdrop">[\s\S]*?<option value="holder-fee">[\s\S]*?<option value="x-fee">/, 'Advanced reward sorts remain available inside Filters.');
assert.match(exploreMarkup, /data-explore-sort="volume"[\s\S]*?data-explore-sort="market-cap"[\s\S]*?data-explore-sort="recent-trade"/, 'The visible sort bar should stay compact.');
assert.match(appSource, /sortMarketRecords\(records\.filter\(asset =>[\s\S]*?asset\.windowVolumeSol != null[\s\S]*?asset\.volume24hUsd != null[\s\S]*?, 'volume'\)\.slice\(0, 8\)/, 'Trending must rank scanned volume independently of the current search and sort.');
assert.match(appSource, /class="explore-ticker-view-all"[\s\S]*?scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/, 'View all must scroll within Explore instead of replacing its route hash.');
assert.match(appSource, /tokenCardAddressesMarkup\(a\.address\)/, 'Gallery addresses must use the verified card mint.');
assert.match(appSource, /class="token-card-copy-address" data-copy-address="\$\{escapeHtml\(value\)\}"/, 'Copy controls must retain the full escaped address.');
assert.match(appSource, /navigator\.clipboard\.writeText\(copy\.dataset\.copyAddress\)/, 'The shared copy action must copy the full address rather than its abbreviated label.');
assert.match(exploreMarkup, /id="explore-benefit-leaders"/);
assert.match(appSource, /document\.querySelector\('#explore-search'\)\?\.addEventListener\('input', event => \{[\s\S]*?document\.querySelector\('#global-search'\)[\s\S]*?field\.value = exploreQuery;[\s\S]*?updateExploreViews\(\);\s*\}\);/, 'Clearing or editing Explore search must keep the persistent global field synchronized.');
assert.match(appSource, /function clearExploreFilters\(\)[\s\S]*?dispatchEvent\(new Event\('funded:explore-filters-cleared'\)\)/, 'Every Explore clear path must notify the workspace filter summary.');
assert.match(workspaceSource, /root\?\.addEventListener\('funded:explore-filters-cleared', save\)/, 'Workspace filter status and persisted view must update after a clear action.');
assert.match(appSource, /toggle\.setAttribute\('aria-label', open \? 'Close launch filters' : 'Open launch filters'\)/, 'The Explore filter control must announce whether it opens or closes the popover.');
assert.match(appSource, /const loading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt/, 'Explore must distinguish its initial loading state from a confirmed empty feed.');
assert.match(appSource, /Loading verified launches…[\s\S]*?Checking the indexed launch feed and confirming current Solana state/, 'Explore must show truthful loading copy while verification is still in flight.');
assert.match(appSource, /if \(!visible\.length && !loading\)/, 'Explore must not offer an empty-feed retry while the first verification is still loading.');
assert.match(appSource, /const feedChecked = Boolean\(exploreUpdatedAt\)[\s\S]*?Checking launches[\s\S]*?Checking confirmed trades/, 'Analytics must not describe pre-fetch launch and trade arrays as confirmed zeroes.');
assert.match(appSource, /const launchFeedUnavailable = verifiedLaunchPoliciesStatus !== 'ready'[\s\S]*?Launch feed unavailable; count not verified/, 'Home must not report zero verified launches when the launch registry is unreachable.');
assert.match(appSource, /const burnSummaryReady = allocationReady[\s\S]*?allocation\.burnedTokens != null[\s\S]*?Number\.isFinite\(Number\(allocation\.burnedTokens\)\)[\s\S]*?burnSummaryReady \? formatDashboardQuantity\(burnedTokens\) : '—'[\s\S]*?Burn receipts unavailable; amount not verified/, 'Home must not report zero burns when receipts are unreachable.');
assert.match(appSource, /function showCoinPage\(open = true\)[\s\S]*?if \(!exploreUpdatedAt && !coinExitExploreLoad\) \{[\s\S]*?loadOnchainExploreData\(\)/, 'Leaving a direct token URL must load Explore even if navigation precedes the token-detail render.');
assert.match(appSource, /const exploreInitialLoadStarted = !coinRouteRequested\(\)[\s\S]*?else if \(!exploreInitialLoadStarted && !exploreUpdatedAt\) showCoinPage\(false\)/, 'Startup must recover a workspace hash selected before the direct-token hashchange listener attached.');
assert.match(appSource, /function withVerifiedExploreBenefits\(record\)[\s\S]*?benefitPolicyVerified: true[\s\S]*?holderFeePercent[\s\S]*?xFeePercent/, 'Explore benefits must derive from a verified launch policy.');
assert.match(appSource, /#explore-promotion-filter'[\s\S]*?explorePromotion = event\.target\.value/);
assert.match(appSource, /#explore-reward-filter'[\s\S]*?exploreReward = event\.target\.value/);
assert.match(appSource, /function readOptionalSolFilter\(selector, \{ integer = false \} = \{\}\)[\s\S]*?number >= 0 && \(!integer \|\| Number\.isInteger\(number\)\)[\s\S]*?input\.value = ''/, 'Invalid minimum values must not remain visible while their filter is ignored.');
assert.match(appSource, /exploreMinTrades = readOptionalSolFilter\('#explore-min-trades', \{ integer: true \}\)/, 'The minimum trade count must reject fractions.');
assert.match(appSource, /exploreMinTraders = readOptionalSolFilter\('#explore-min-traders', \{ integer: true \}\)/, 'The minimum trading-wallet count must reject fractions.');
assert.deepEqual(filterMarketRecords([
  { address: 'below', curveCapSol: 0.95 },
  { address: 'above', curveCapSol: 1.05 },
], { minCurveCapSol: 1 }).map(item => item.address), ['above']);

const records = [
  { address: 'curveMint', name: 'Curve Token', symbol: 'CURVE', complete: false, createdTimestamp: 100, marketCapUsd: null, volume24hUsd: null, liquidityUsd: null, priceChange24hPercent: null },
  { address: 'poolMint', name: 'Pool Token', symbol: 'POOL', complete: true, createdTimestamp: 200, marketCapUsd: 20000, volume24hUsd: 1500, liquidityUsd: 7000, priceChange24hPercent: -4 },
  { address: 'unknownMint', name: 'Unknown Token', symbol: 'UNK', complete: null, createdTimestamp: 300 },
].map(enrichMarketRecord);

assert.deepEqual(filterMarketRecords(records, { stage: 'curve' }).map(item => item.address), ['curveMint']);
assert.deepEqual(filterMarketRecords(records, { stage: 'graduated' }).map(item => item.address), ['poolMint']);
assert.deepEqual(filterMarketRecords(records, { stage: 'all', sort: 'newest' }).map(item => item.address), ['unknownMint', 'poolMint', 'curveMint']);
assert.deepEqual(filterMarketRecords(records, { query: 'poolmint', stage: 'graduated' }).map(item => item.address), ['poolMint']);
assert.deepEqual(filterMarketRecords(records, { risk: 'watchlist', watchlist: ['curveMint'] }).map(item => item.address), ['curveMint']);
const summary = summarizeMarkets(records);
assert.equal(summary.volume24hUsd, 1500);
assert.equal(summary.liquidityUsd, 7000);
assert.equal(records[0].marketCapUsd, null);
assert.equal(records[0].volume24hUsd, null);
const curve = readCurveMetrics({ complete: false, virtualTokenReserves: 1_000_000_000n, virtualQuoteReserves: 1_000_000_000n, realQuoteReserves: 500_000_000n }, { supply: 1_000_000_000n, decimals: 6 });
assert.equal(curve.curvePriceSol, 0.001);
assert.equal(curve.curveCapSol, 1);
assert.equal(curve.curveReserveSol, 0.5);
assert.equal(curve.curveProgressPercent, null);
assert.equal(formatSolMetric(0), '0 SOL');
assert.equal(formatSolMetric(0.000495048, { partial: true }), '≥0.000495 SOL');
assert.equal(formatSolMetric(null), '—');
assert.equal(readCurveMetrics({ complete: true, virtualTokenReserves: 1n, virtualQuoteReserves: 1n }, { supply: 1n, decimals: 6 }).curveCapSol, null);
assert.deepEqual(readPumpSwapMetrics({ baseAmount: 200_000_000n, quoteAmount: 1_000_000_000n, virtualQuoteAmount: 1_000_000_000n, baseDecimals: 6, supply: 1_000_000_000n }), {
  poolPriceSol: 0.01,
  poolMarketCapSol: 10,
  poolReserveSol: 1,
});
assert.deepEqual(readPumpSwapMetrics({ baseAmount: 0n, quoteAmount: 500_000_000n, baseDecimals: 6, supply: 1_000_000_000n }), { poolPriceSol: null, poolMarketCapSol: null, poolReserveSol: 0.5 });
assert.match(appSource, /item\.holders == null \|\| item\.holders === '' \? NaN : Number\(item\.holders\)/, 'A missing indexed holder value must not become a false zero.');
assert.match(appSource, /<small>Holders<\/small>/, 'Home cards must label distinct wallet owners as holders.');
assert.match(appSource, /function exploreDevnetVolume\(record\)\{ return record\.migrated === true \? 'Unindexed'/, 'Migrated cards must not present curve-only activity as complete pool volume.');
assert.match(appSource, /function exploreMarketCapUsd\(record\)/, 'Explore cards must derive USD market cap from the verified curve or pool snapshot.');
assert.match(appSource, /class="asset-value"[^>]*>\$\{escapeHtml\(exploreMarketCapLabel\(a\)\)\} · \$\{escapeHtml\(exploreMarketCapUsd\(a\)\)\}/, 'Explore card footers must show USD market cap instead of a long decimal spot price.');
const solRecords = [
  { address: 'lowVolume', symbol: 'LOW', createdTimestamp: 1, volume24hSol: 0.1, curveCapSol: 2, curveReserveSol: 0 },
  { address: 'highVolume', symbol: 'HIGH', createdTimestamp: 2, volume24hSol: 0.2, curveCapSol: 1, curveReserveSol: 0.5 },
].map(enrichMarketRecord);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'volume' }).map(item => item.address), ['highVolume', 'lowVolume']);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'market-cap' }).map(item => item.address), ['lowVolume', 'highVolume']);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'liquidity' }).map(item => item.address), ['highVolume', 'lowVolume']);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'turnover' }).map(item => item.address), ['highVolume', 'lowVolume']);
const migratedMarket = enrichMarketRecord({ address: 'pool', migrated: true, poolMarketCapSol: 5, poolReserveSol: 1, volume24hSol: 99, curveCapSol: null, curveReserveSol: null });
assert.equal(migratedMarket.poolMarketCapSol, 5);
assert.equal(migratedMarket.turnover, null, 'Curve-only volume must not be divided by a migrated pool market cap.');
assert.equal(migratedMarket.riskFlags.includes('market-cap-unavailable'), false);
assert.equal(migratedMarket.riskFlags.includes('liquidity-unavailable'), false);
assert.deepEqual(filterMarketRecords([migratedMarket, ...solRecords], { sort: 'market-cap' }).map(item => item.address), ['pool', 'lowVolume', 'highVolume']);
assert.deepEqual(filterMarketRecords([migratedMarket], { minCurveCapSol: 4 }).map(item => item.address), ['pool']);
assert.deepEqual(filterMarketRecords([{ address: 'oldActive', createdTimestamp: 1, lastTradeUnixTime: 9 }, { address: 'newQuiet', createdTimestamp: 8, lastTradeUnixTime: 0 }].map(enrichMarketRecord), { sort: 'recent-trade' }).map(item => item.address), ['oldActive', 'newQuiet']);
const nowMs = 1_000_000_000;
const discovery = [
  { address: 'near', symbol: 'NEAR', complete: false, curveProgressPercent: 85, createdTimestamp: (nowMs - 3_600_000) / 1000, volume24hSol: 0.02, curveCapSol: 2 },
  { address: 'old', symbol: 'OLD', complete: false, curveProgressPercent: 25, createdTimestamp: (nowMs - 30 * 3_600_000) / 1000, volume24hSol: 0.005, curveCapSol: 1 },
  { address: 'completeOnly', symbol: 'DONE', complete: true, migrated: false, createdTimestamp: (nowMs - 2 * 3_600_000) / 1000 },
  { address: 'migrated', symbol: 'MOVED', complete: true, migrated: true, pumpSwapPool: 'verified', createdTimestamp: (nowMs - 48 * 3_600_000) / 1000 },
].map(enrichMarketRecord);
assert.deepEqual(filterMarketRecords(discovery, { stage: 'near' }).map(item => item.address), ['near']);
assert.deepEqual(filterMarketRecords(discovery, { stage: 'launch', maxAgeHours: 24, nowMs }).map(item => item.address), ['near']);
assert.deepEqual(filterMarketRecords(discovery, { stage: 'migrated' }).map(item => item.address), ['migrated']);
assert.deepEqual(filterMarketRecords(discovery, { stage: 'graduated' }).map(item => item.address), ['completeOnly', 'migrated']);
assert.deepEqual(filterMarketRecords(discovery, { stage: 'migrated', maxAgeHours: 24, nowMs }), [], 'Migrated tokens must not inherit the New Launch 24h limit.');
assert.deepEqual(filterMarketRecords(discovery, { minVolumeSol: 0.01 }).map(item => item.address), ['near']);
assert.deepEqual(filterMarketRecords(discovery, { minCurveCapSol: 1.5 }).map(item => item.address), ['near']);
const activityRecords = [
  { address: 'busy', symbol: 'BUSY', tradeCount24h: 12, buyCount24h: 8, sellCount24h: 4 },
  { address: 'quiet', symbol: 'QUIET', tradeCount24h: 2, buyCount24h: 1, sellCount24h: 1 },
  { address: 'unscanned', symbol: 'UNKNOWN' },
].map(enrichMarketRecord);
assert.deepEqual(filterMarketRecords(activityRecords, { sort: 'trades' }).map(item => item.address), ['busy', 'quiet', 'unscanned']);
assert.deepEqual(filterMarketRecords(activityRecords, { minTrades: 3 }).map(item => item.address), ['busy']);
assert.equal(activityRecords[2].tradeCount24h, null, 'Unscanned trades must stay unavailable, not zero.');
const benefitRecords = [
  { address: 'premier', promotionTier: 'premier', benefitPolicyVerified: true, communityAirdropPercent: 3, holderFeePercent: 20, xFeePercent: 0, creatorFeePercent: 60 },
  { address: 'boost', promotionTier: 'boost', benefitPolicyVerified: true, communityAirdropPercent: 8, holderFeePercent: 0, xFeePercent: 25, creatorFeePercent: 55 },
  { address: 'standard', promotionTier: 'standard', benefitPolicyVerified: true, communityAirdropPercent: 0, holderFeePercent: 0, xFeePercent: 0, creatorFeePercent: 80 },
  { address: 'unpublished' },
].map(enrichMarketRecord);
assert.deepEqual(filterMarketRecords(benefitRecords, { promotion: 'promoted' }).map(item => item.address), ['premier', 'boost']);
assert.deepEqual(filterMarketRecords(benefitRecords, { promotion: 'standard' }).map(item => item.address), ['standard']);
assert.deepEqual(filterMarketRecords(benefitRecords, { reward: 'community-airdrop' }).map(item => item.address), ['premier', 'boost']);
assert.deepEqual(filterMarketRecords(benefitRecords, { reward: 'holder-fees' }).map(item => item.address), ['premier']);
assert.deepEqual(filterMarketRecords(benefitRecords, { reward: 'x-fees' }).map(item => item.address), ['boost']);
assert.deepEqual(filterMarketRecords(benefitRecords, { reward: 'creator-wallet' }).map(item => item.address), ['premier', 'boost', 'standard']);
assert.deepEqual(filterMarketRecords(benefitRecords, { sort: 'airdrop' }).map(item => item.address), ['boost', 'premier', 'standard', 'unpublished']);
assert.deepEqual(filterMarketRecords(benefitRecords, { sort: 'holder-fee' }).map(item => item.address), ['premier', 'boost', 'standard', 'unpublished']);
assert.deepEqual(filterMarketRecords(benefitRecords, { sort: 'x-fee' }).map(item => item.address), ['boost', 'premier', 'standard', 'unpublished']);
const authorityRecords = [
  { address: 'revoked', mintAuthorityRevoked: true, freezeAuthorityRevoked: true },
  { address: 'mintable', mintAuthorityRevoked: false, freezeAuthorityRevoked: true },
  { address: 'freezable', mintAuthorityRevoked: true, freezeAuthorityRevoked: false },
  { address: 'unknown' },
].map(enrichMarketRecord);
assert.deepEqual(filterMarketRecords(authorityRecords, { authority: 'both-revoked' }).map(item => item.address), ['revoked']);
assert.deepEqual(filterMarketRecords(authorityRecords, { authority: 'mint-active' }).map(item => item.address), ['mintable']);
assert.deepEqual(filterMarketRecords(authorityRecords, { authority: 'freeze-active' }).map(item => item.address), ['freezable']);
const signature = '1'.repeat(88);
const recentTrades = collectRecentTrades([
  { address: 'first', symbol: 'ONE', volumeCoverage: 'partial', recentTrades: [{ signature, blockTime: 100, side: 'buy', solLamports: '1000000000' }] },
  { address: 'second', symbol: 'TWO', recentTrades: [{ signature, blockTime: 200, side: 'sell', solLamports: '250000000' }, { signature: 'invalid', blockTime: 300, side: 'buy', solLamports: '1000' }] },
]);
assert.deepEqual(recentTrades.map(item => item.mint), ['second', 'first']);
assert.equal(recentTrades[0].solAmount, 0.25);
assert.equal(recentTrades[1].coverage, 'partial');
assert.deepEqual(collectRecentTrades([
  { address: 'first', recentTrades: [{ signature, blockTime: 100, side: 'buy', solLamports: '1000000000' }] },
  { address: 'second', recentTrades: [{ signature, blockTime: 200, side: 'sell', solLamports: '250000000' }] },
], { since: 150 }).map(item => item.mint), ['second']);
const windowRecords = [
  { address: 'early', curveCapSol: 2, volume24hSol: 10, tradeCount24h: 10, activityWindows: {
    '1h': { volumeSol: 0, tradeCount: 0, buyCount: 0, sellCount: 0, traderCount: 0, coverage: 'complete' },
    '6h': { volumeSol: 3, tradeCount: 3, buyCount: 2, sellCount: 1, traderCount: 2, coverage: 'complete' },
    '24h': { volumeSol: 10, tradeCount: 10, buyCount: 7, sellCount: 3, traderCount: 4, coverage: 'complete' },
  } },
  { address: 'recent', curveCapSol: 1, volume24hSol: 2, tradeCount24h: 2, activityWindows: {
    '1h': { volumeSol: 1, tradeCount: 1, buyCount: 1, sellCount: 0, traderCount: 1, coverage: 'partial' },
    '6h': { volumeSol: 2, tradeCount: 2, buyCount: 1, sellCount: 1, traderCount: 1, coverage: 'partial' },
    '24h': { volumeSol: 2, tradeCount: 2, buyCount: 1, sellCount: 1, traderCount: 1, coverage: 'partial' },
  } },
].map(item => withMarketWindow(item, '1h'));
assert.deepEqual(filterMarketRecords(windowRecords, { sort: 'volume' }).map(item => item.address), ['recent', 'early']);
assert.deepEqual(filterMarketRecords(windowRecords, { minVolumeSol: 0.5 }).map(item => item.address), ['recent']);
assert.deepEqual(filterMarketRecords(windowRecords, { minTrades: 1 }).map(item => item.address), ['recent']);
assert.deepEqual(filterMarketRecords(windowRecords, { minTraders: 1 }).map(item => item.address), ['recent']);
assert.deepEqual(filterMarketRecords(windowRecords, { minTraders: 2 }).map(item => item.address), []);
assert.equal(windowRecords[0].windowVolumeSol, 0, 'Confirmed empty window is zero.');
assert.equal(windowRecords[1].windowCoverage, 'partial');
assert.equal(withMarketWindow({ volume24hSol: 3, tradeCount24h: 4 }, '1h').windowVolumeSol, null, 'Missing short-window history must not borrow 24h data.');
assert.equal(discovery[0].riskFlags.includes('thin-liquidity'), false, 'Missing USD liquidity must not be read as zero USD liquidity.');
assert.equal(readCurveMetrics({ complete: false, virtualTokenReserves: 100n, realTokenReserves: 15n, virtualQuoteReserves: 100n, realQuoteReserves: 0n }, { supply: 100n, decimals: 0 }).curveProgressPercent, 85);
const devnetRegistry = [
  { mint: 'a', createdTimestamp: 100, lastTradeTimestamp: 400, marketCapUsd: null },
  { mint: 'b', createdTimestamp: 200, lastTradeTimestamp: 250, marketCapUsd: 2 },
  { mint: 'c', createdTimestamp: 300, lastTradeTimestamp: null, marketCapUsd: 1 },
];
assert.deepEqual(sortDevnetLaunches(devnetRegistry, 'created_timestamp').map(item => item.mint), ['c', 'b', 'a']);
assert.deepEqual(sortDevnetLaunches(devnetRegistry, 'last_trade_timestamp').map(item => item.mint), ['a', 'c', 'b']);
assert.deepEqual(sortDevnetLaunches(devnetRegistry, 'market_cap').map(item => item.mint), ['b', 'c', 'a']);
console.log('explore discovery checks passed');
