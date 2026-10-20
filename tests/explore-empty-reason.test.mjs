import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMarketRecords } from '../market-intelligence.js';
import { exploreEmptyReason } from '../src/features/explore/status-view.js';

const premier = { address: 'premier-mint', name: 'Fee premier QA', symbol: 'PREM', promotionTier: 'premier', holderFeePercent: 0 };
const holder = { address: 'holder-mint', name: 'Holder rewards QA', symbol: 'HOLD', promotionTier: 'standard', holderFeePercent: 10 };
const assets = [premier, holder];
const state = {
  exploreTab: 'trending', assets, exploreQuery: '', explorePromotion: 'all', exploreReward: 'all',
  exploreRisk: 'all', exploreStage: 'all', exploreAuthority: 'all', exploreNewLane: 'all',
  exploreMinVolumeUsd: null, exploreMinMarketCapUsd: null, exploreMinTrades: null,
  exploreMinTraders: null, exploreMaxAgeHours: null, coinSolUsdPrice: 100,
};

test('combined empty guidance names the active criteria while independent matches remain discoverable', () => {
  assert.equal(filterMarketRecords(assets, { promotion: 'premier' })[0].address, premier.address);
  assert.equal(filterMarketRecords(assets, { reward: 'holder-fees' })[0].address, holder.address);
  assert.equal(filterMarketRecords(assets, { query: premier.name })[0].address, premier.address);
  assert.equal(filterMarketRecords(assets, { promotion: 'premier', reward: 'holder-fees' }).length, 0);

  const combined = exploreEmptyReason({ ...state, explorePromotion: 'premier', exploreReward: 'holder-fees' });
  assert.equal(combined[0], 'No tokens match this combination.');
  assert.match(combined[1], /Active filters apply together/);
  assert.equal(combined[2], 'Premier · Holder rewards');

  const withQuery = exploreEmptyReason({ ...state, explorePromotion: 'premier', exploreReward: 'holder-fees', exploreQuery: premier.name });
  assert.equal(withQuery[0], 'No tokens match this combination.');
  assert.equal(withQuery[2], 'Premier · Holder rewards · Search: Fee premier QA');
});

test('a lone query or tier has specific wording; missing quote and saved views retain their own reasons', () => {
  assert.match(exploreEmptyReason({ ...state, exploreQuery: 'absent' })[0], /search/);
  assert.match(exploreEmptyReason({ ...state, explorePromotion: 'premier' })[0], /Premier/);
  assert.match(exploreEmptyReason({ ...state, explorePromotion: 'pro' })[0], /Pro/);
  assert.match(exploreEmptyReason({ ...state, explorePromotion: 'standard' })[0], /Standard/);
  assert.match(exploreEmptyReason({ ...state, explorePromotion: 'premier', exploreReward: 'holder-fees', exploreMinVolumeUsd: 5, coinSolUsdPrice: null })[0], /conversion quote/);
  assert.match(exploreEmptyReason({ ...state, exploreTab: 'favorites', explorePromotion: 'premier', exploreReward: 'holder-fees' }, { getWatchlist: () => [] })[0], /favorite tokens/);
  assert.match(exploreEmptyReason({ ...state, exploreRisk: 'watchlist', explorePromotion: 'premier', exploreReward: 'holder-fees' }, { getWatchlist: () => [] })[0], /favorite tokens/);
  assert.match(exploreEmptyReason({ ...state, exploreTab: 'following', explorePromotion: 'premier', exploreReward: 'holder-fees' }, {
    getFollowingCoverage: () => ({ total: 0 }), getFollowingTokenSources: () => new Map(),
  })[0], /followed wallets/);
});
