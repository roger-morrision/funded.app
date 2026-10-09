import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHomeLaunchBoard } from '../src/features/home/launch-board-view.js';
import { renderRegistry } from '../src/features/explore/registry-view.js';
import { emptyHomeLaunchFilters } from '../home-launch-filters.js';

function dom() {
  const fields = new Map();
  const element = () => ({ hidden: false, dataset: {}, attributes: {}, textContent: '', innerHTML: '',
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelector: selector => fields.get(selector) || null, querySelectorAll: () => [],
  });
  return { fields, document: { querySelector: selector => fields.get(selector) || null, querySelectorAll: () => [] },
    add(selector) { const node = element(); fields.set(selector, node); return node; } };
}
function homeFixture() {
  const ui = dom(), order = [];
  for (const selector of ['#home-launch-grid', '#home-launch-table-wrap', '#home-launch-table-body', '#home-feed-state', '#home-board-count']) ui.add(selector);
  const state = { EXPLORE_CLUSTER: 'mainnet-beta', homeLaunchView: 'grid', exploreFeedAvailable: true, exploreLastVerifiedAt: null,
    homeLaunchWindow: '24h', assets: [], homeFeeAmounts: new Map(), coinSolUsdPrice: 100, homeLaunchSort: 'live',
    verifiedBoosts: {}, homeLaunchTab: 'all', homeLaunchFilters: emptyHomeLaunchFilters(), homeLaunchPaused: false,
    homeFrozenOrder: null, exploreProviderStatus: 'available' };
  const callbacks = { document: ui.document, verifiedLaunchPolicyForMint: mint => mint !== 'unverified',
    withVerifiedExploreBenefits: item => item, launchCardVolumeUsd: () => '0', exploreBoostAmountMarkup: () => '',
    setupHomeTicker() {}, getWatchlist: () => [], promotionForMint: () => null, formatCoinUsd: value => `$${value}`,
    loadVerifiedTokenLogos() {}, homeLaunchCardMarkup: item => { order.push(item.address); return item.address; }, decorateHomeLaunchCard() {} };
  return { ...ui, state, callbacks, order, render() { order.length = 0; renderHomeLaunchBoard(state, callbacks); } };
}
const coin = (address, extra = {}) => ({ address, name: address, symbol: address.toUpperCase(), createdTimestamp: 1,
  volume24hUsd: 0, complete: false, marketCapUsd: 100, ...extra });

test('Home includes old zero-volume launches but excludes unverified tokens', () => {
  const f = homeFixture();
  f.state.assets = [coin('old'), coin('unverified', { volume24hUsd: 999 }), coin('new', { createdTimestamp: 100 })];
  f.render();
  assert.deepEqual(f.order, ['new', 'old']);
  assert.equal(f.fields.get('#home-board-count').textContent, 'Showing 2 verified coins');
  assert(!f.fields.get('#home-launch-grid').hidden);
  assert(f.fields.get('#home-launch-table-wrap').hidden);
});

test('Home pause persists ordering across refreshes and resumes current ranking', () => {
  const f = homeFixture();
  f.state.assets = [coin('a', { volume24hUsd: 2 }), coin('b', { volume24hUsd: 1 })];
  f.state.homeLaunchPaused = true;
  f.render();
  assert.deepEqual(f.state.homeFrozenOrder, ['a', 'b']);
  f.state.assets = [coin('b', { volume24hUsd: 10 }), coin('c', { volume24hUsd: 100 }), coin('a')];
  f.render();
  assert.deepEqual(f.order, ['a', 'b', 'c']);
  f.state.homeLaunchPaused = false;
  f.state.homeFrozenOrder = null;
  f.render();
  assert.deepEqual(f.order, ['c', 'b', 'a']);
});

test('Home table retains filters and escapes token metadata', () => {
  const f = homeFixture();
  f.state.homeLaunchView = 'table';
  f.state.homeLaunchTab = 'migrated';
  f.state.assets = [coin('curve'), coin('pool', { migrated: true, name: '<img onerror=bad>', symbol: '<svg>' })];
  f.render();
  assert.deepEqual(f.order, ['pool']);
  assert(f.fields.get('#home-launch-grid').hidden);
  assert(!f.fields.get('#home-launch-table-wrap').hidden);
  assert.match(f.fields.get('#home-launch-table-body').innerHTML, /&lt;img/);
  assert.doesNotMatch(f.fields.get('#home-launch-table-body').innerHTML, /<svg>/);
  f.state.homeLaunchTab = 'watchlist';
  f.render();
  assert.match(f.fields.get('#home-launch-grid').innerHTML, /No favorite tokens/);
});

function registryFixture() {
  const ui = dom();
  for (const selector of ['#scanner-count', '#scanner-range', '#scanner-page-label', '#scanner-pagination', '#scanner-page-numbers',
    '[data-registry-page="prev"]', '[data-registry-page="next"]', '#launch-list']) ui.add(selector);
  const state = { EXPLORE_CLUSTER: 'devnet', registryCriteriaKey: '', registryPage: 1,
    registryLaunches: Array.from({ length: 23 }, (_, i) => coin(`mint${i}`)), assets: [],
    exploreProviderStatus: 'available', exploreFeedAvailable: true, exploreLastVerifiedAt: 'today', verifiedBoosts: {} };
  const callbacks = { document: ui.document, getWatchlist: () => [], filterExploreTabRecords: (rows, query) => query ? rows.filter(row => row.name.includes(query)) : rows,
    exploreOutageCopy: () => ({ title: 'Feed unavailable', detail: 'Try again later' }), exploreEmptyReason: () => ['No matching launches', 'Clear filters'],
    exploreStageLabel: () => 'On curve', formatOnchainAge: () => 'old', explorePaidListingBagMarkup: () => '', exploreBoostAmountMarkup: () => '',
    exploreSocialLinksMarkup: () => '', exploreTierBadgeMarkup: () => '', exploreMarketCapUsd: () => '$2,700', formatExploreTradeCount: () => '0',
    formatExploreUsd: () => '$0', exploreAirdropMarkup: () => '', loadVerifiedTokenLogos() {}, renderWatchlist() {} };
  return { ...ui, state, callbacks, render(query = '') { renderRegistry(query, state, callbacks); } };
}

test('Explore keeps the requested page until criteria change and clamps shorter refreshed lists', () => {
  const f = registryFixture();
  f.render();
  f.state.registryPage = 2;
  f.render();
  assert.equal(f.state.registryPage, 2);
  assert.equal(f.fields.get('#scanner-range').textContent, '11–20 of 23 launches');
  assert.match(f.fields.get('#launch-list').innerHTML, /data-logo-mint="mint10"/);
  assert.match(f.fields.get('#launch-list').innerHTML, /\$2,700/);
  f.render('mint2');
  assert.equal(f.state.registryPage, 1);
  assert.equal(f.fields.get('#scanner-range').textContent, '1–4 of 4 launches');
  f.render();
  f.state.registryPage = 3;
  f.state.registryLaunches = [coin('new')];
  f.render();
  assert.equal(f.state.registryPage, 1);
  assert(f.fields.get('#scanner-pagination').hidden);
});

test('Explore distinguishes loading, unavailable, and an empty filtered result', () => {
  const f = registryFixture();
  f.state.registryLaunches = [];
  f.state.exploreLastVerifiedAt = null;
  f.state.exploreProviderStatus = 'On-chain only · loading';
  f.render();
  assert.match(f.fields.get('#launch-list').innerHTML, /Checking the verified launch feed/);
  f.state.exploreProviderStatus = 'RPC unavailable';
  f.state.exploreFeedAvailable = false;
  f.render();
  assert.match(f.fields.get('#launch-list').innerHTML, /Feed unavailable/);
  assert.match(f.fields.get('#launch-list').innerHTML, /data-verified-feed-retry/);
  f.state.exploreProviderStatus = 'available';
  f.state.exploreFeedAvailable = true;
  f.render();
  assert.match(f.fields.get('#launch-list').innerHTML, /No matching launches/);
  assert.doesNotMatch(f.fields.get('#launch-list').innerHTML, /data-verified-feed-retry/);
});
