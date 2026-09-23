import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectRecentTrades, enrichMarketRecord, filterMarketRecords, summarizeMarkets, withMarketWindow } from '../market-intelligence.js';
import { formatSolMetric, readCurveMetrics } from '../explore-onchain-metrics.js';
import { sortDevnetLaunches } from '../server/explore-registry.mjs';

const exploreMarkup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(exploreMarkup, /Minimum curve cap · SOL\s*<input id="explore-min-cap-sol"/);
assert.match(exploreMarkup, /Minimum 24h traded · SOL<\/span><input id="explore-min-volume-sol"/);
assert.match(exploreMarkup, /id="explore-promotion-filter"[\s\S]*?Any paid promotion[\s\S]*?Premier/);
assert.match(exploreMarkup, /id="explore-reward-filter"[\s\S]*?Community token airdrop[\s\S]*?Creator fees → holders[\s\S]*?Creator fees → X account/);
assert.match(exploreMarkup, /data-explore-sort="airdrop"[\s\S]*?data-explore-sort="holder-fee"[\s\S]*?data-explore-sort="x-fee"/);
assert.match(exploreMarkup, /id="explore-benefit-leaders"/);
assert.match(appSource, /document\.querySelector\('#explore-search'\)\?\.addEventListener\('input', event => \{[\s\S]*?document\.querySelector\('#global-search'\)[\s\S]*?field\.value = exploreQuery;[\s\S]*?updateExploreViews\(\);\s*\}\);/, 'Clearing or editing Explore search must keep the persistent global field synchronized.');
assert.match(appSource, /function withVerifiedExploreBenefits\(record\)[\s\S]*?benefitPolicyVerified: true[\s\S]*?holderFeePercent[\s\S]*?xFeePercent/, 'Explore benefits must derive from a verified launch policy.');
assert.match(appSource, /#explore-promotion-filter'[\s\S]*?explorePromotion = event\.target\.value/);
assert.match(appSource, /#explore-reward-filter'[\s\S]*?exploreReward = event\.target\.value/);
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
const solRecords = [
  { address: 'lowVolume', symbol: 'LOW', createdTimestamp: 1, volume24hSol: 0.1, curveCapSol: 2, curveReserveSol: 0 },
  { address: 'highVolume', symbol: 'HIGH', createdTimestamp: 2, volume24hSol: 0.2, curveCapSol: 1, curveReserveSol: 0.5 },
].map(enrichMarketRecord);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'volume' }).map(item => item.address), ['highVolume', 'lowVolume']);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'market-cap' }).map(item => item.address), ['lowVolume', 'highVolume']);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'liquidity' }).map(item => item.address), ['highVolume', 'lowVolume']);
assert.deepEqual(filterMarketRecords(solRecords, { sort: 'turnover' }).map(item => item.address), ['highVolume', 'lowVolume']);
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
