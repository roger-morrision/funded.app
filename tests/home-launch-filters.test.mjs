import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHomeLaunchFilters, homeLaunchFilterCount, matchesHomeLaunchFilters, normalizeHomeLaunchFilters } from '../home-launch-filters.js';

const nowMs = Date.UTC(2026, 9, 2, 0);
const base = {
  address: 'mint123', name: 'Example Coin', symbol: 'EX', complete: false, migrated: false,
  mintAuthorityRevoked: true, freezeAuthorityRevoked: true, website: 'https://example.test',
  promotionTier: 'boost', holderFeePercent: 20, communityAirdropPercent: 5,
  createdTimestamp: (nowMs - 3_600_000) / 1000, curveCapSol: 100, curveReserveSol: 20,
  windowVolumeSol: 5, windowTradeCount: 12, windowCoverage: 'complete', holderWalletCount: 10,
  holderWalletCoverage: 'complete',
  topTenHolderPercent: 23.5, devHoldingPercent: 4, collectedCreatorFeesSol: 0.25,
};
const context = { cluster: 'devnet', solUsdPrice: 200, nowMs };

test('query and available launch signals combine without guessing missing values', () => {
  const filters = emptyHomeLaunchFilters();
  filters.query = 'example';
  filters.flags = ['curve', 'mintRevoked', 'freezeRevoked', 'social', 'promoted', 'holderFees', 'airdrop'];
  assert.equal(matchesHomeLaunchFilters(base, filters, context), true);
  assert.equal(matchesHomeLaunchFilters({ ...base, website: null }, filters, context), false);
  assert.equal(matchesHomeLaunchFilters({ ...base, mintAuthorityRevoked: null }, filters, context), false);
  filters.flags = ['curve', 'migrated'];
  assert.equal(matchesHomeLaunchFilters({ ...base, complete: true, migrated: true }, filters, context), true);
});

test('ranges use observed values, reject missing metrics, and respect partial upper bounds', () => {
  const filters = emptyHomeLaunchFilters();
  filters.ranges.marketCapUsd.min = 10_000;
  filters.ranges.reserveUsd.max = 5_000;
  filters.ranges.volumeUsd.min = 500;
  filters.ranges.trades.max = 20;
  filters.ranges.ageHours.max = 2;
  assert.equal(matchesHomeLaunchFilters(base, filters, context), true);
  assert.equal(matchesHomeLaunchFilters(base, filters, { ...context, solUsdPrice: null }), false);
  assert.equal(matchesHomeLaunchFilters({ ...base, windowCoverage: 'partial' }, filters, context), false);
  assert.equal(matchesHomeLaunchFilters({ ...base, createdTimestamp: null }, filters, context), false);
});

test('sampled holder lower bounds can satisfy minimums but not maximums', () => {
  const filters = emptyHomeLaunchFilters();
  filters.ranges.holders.min = 8;
  assert.equal(matchesHomeLaunchFilters({ ...base, holderWalletCoverage: 'lower-bound' }, filters, context), true);
  filters.ranges.holders.max = 12;
  assert.equal(matchesHomeLaunchFilters({ ...base, holderWalletCoverage: 'lower-bound' }, filters, context), false);
  assert.equal(matchesHomeLaunchFilters(base, filters, context), true);
});

test('saved filters are normalized to supported fields and counted', () => {
  const filters = normalizeHomeLaunchFilters({ query: ' EX ', flags: ['curve', 'unknown'], ranges: { trades: { min: 5, max: -1 } } });
  assert.deepEqual(filters.flags, ['curve']);
  assert.equal(filters.query, 'EX');
  assert.equal(filters.ranges.trades.min, 5);
  assert.equal(filters.ranges.trades.max, null);
  assert.equal(homeLaunchFilterCount(filters), 3);
});

test('holder concentration ranges require a complete indexed value', () => {
  const filters = emptyHomeLaunchFilters();
  filters.ranges.topTenHolderPercent.max = 30;
  filters.ranges.devHoldingPercent.min = 2;
  assert.equal(matchesHomeLaunchFilters(base, filters, context), true);
  assert.equal(matchesHomeLaunchFilters({ ...base, topTenHolderPercent: null }, filters, context), false);
  assert.equal(matchesHomeLaunchFilters({ ...base, devHoldingPercent: 1 }, filters, context), false);
});

test('collected creator fees use the verified ledger value when available', () => {
  const filters = emptyHomeLaunchFilters();
  filters.ranges.collectedCreatorFeesSol.min = 0.2;
  filters.ranges.collectedCreatorFeesSol.max = 0.3;
  assert.equal(matchesHomeLaunchFilters(base, filters, context), true);
  assert.equal(matchesHomeLaunchFilters({ ...base, collectedCreatorFeesSol: null }, filters, context), false);
});
