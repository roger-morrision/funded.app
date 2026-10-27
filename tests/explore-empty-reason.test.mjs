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

// UX-008 selected-window availability; controlled pure state, no browser or network.
import { withMarketWindow } from '../market-intelligence.js';
import { createExploreFiltersController } from '../src/app/controllers/explore-filters.js';
const activityHeadline = 'Available activity data cannot confirm matches.';
const activityPeriods = ['5m', '1h', '6h', '24h'];
const activityMetrics = [
  ['trades', 'exploreMinTrades', 'tradeCount', 'windowTradeCount', 'minTrades'],
  ['wallets', 'exploreMinTraders', 'traderCount', 'windowTraderCount', 'minTraders'],
  ['volume', 'exploreMinVolumeUsd', 'volumeSol', 'windowVolumeSol', 'minVolumeSol'],
];
const activityRow = (period, metric, value, coverage = 'complete') => ({
  ...premier,
  activityWindows: Object.fromEntries(activityPeriods.map(p => [p, {
    tradeCount: 0, traderCount: 0, volumeSol: 0, coverage: 'complete',
    ...(p === period ? { [metric]: value, coverage } : {}),
  }])),
});
const activityState = (period, key, rows) => ({
  ...state, assets: rows, EXPLORE_CLUSTER: 'devnet', exploreWindow: period,
  [key]: key === 'exploreMinVolumeUsd' ? 100 : 1,
});
for (const period of activityPeriods) for (const [name,key,metric,windowMetric,filterKey] of activityMetrics) {
  test(`UX-008 ${period} ${name}: missing/partial/known zero/complete below/positive controls`, () => {
    for (const [value,coverage,unknown] of [[null,'complete',true],[0,'partial',true],[0,'complete',false],[0.5,'complete',name !== 'volume']]) {
      const row=activityRow(period,metric,value,coverage),s=activityState(period,key,[row]);
      const reason=exploreEmptyReason(s);
      assert.equal(reason[0]===activityHeadline,unknown,JSON.stringify({period,name,value,coverage,reason}));
      if (unknown) assert.match(reason[1],new RegExp(`Some ${period} activity data is unavailable or incomplete`));
      else assert.match(reason[0],/No launch meets/);
      assert.equal(filterMarketRecords([withMarketWindow(row,period)],{[filterKey]:1}).length,0);
    }
    const positive=activityRow(period,metric,2),windowed=withMarketWindow(positive,period);
    assert.equal(windowed[windowMetric],2);
    assert.deepEqual(filterMarketRecords([windowed],{[filterKey]:1}).map(r=>r.address),[premier.address]);
    const partialPositive=withMarketWindow(activityRow(period,metric,2,'partial'),period);
    assert.equal(filterMarketRecords([partialPositive],{[filterKey]:1}).length,1,'A partial lower bound above the minimum remains a matching row');
    assert.equal(filterMarketRecords([withMarketWindow(activityRow(period,metric,0),period)],{[filterKey]:0}).length,1,'A complete known zero meets a zero minimum');
  });
}
for (const period of activityPeriods) test(`UX-008 ${period}: another complete window and raw derived fields cannot certify selected trades`,()=>{
  const other=period==='24h'?'6h':'24h';
  const row={...premier,volumeCoverage:'complete',windowCoverage:'complete',windowTradeCount:999,
    activityWindows:{[other]:{volumeSol:3,tradeCount:3,traderCount:3,coverage:'complete'}}};
  assert.equal(withMarketWindow(row,period).windowTradeCount,null);
  assert.equal(exploreEmptyReason(activityState(period,'exploreMinTrades',[row]))[0],activityHeadline);
});
for (const [name,key,metric] of activityMetrics) test(`UX-008 ${name}: unrelated missing metrics do not make a complete relevant zero unknown`,()=>{
  const row=activityRow('1h',metric,0);
  for (const [, ,other] of activityMetrics) if(other!==metric) row.activityWindows['1h'][other]=null;
  assert.match(exploreEmptyReason(activityState('1h',key,[row]))[0],/No launch meets/);
});
test('UX-008 partially checked candidates and partial-history lower bounds qualify the empty outcome',()=>{
  const zero=activityRow('1h','tradeCount',0),unknown={...holder};
  const partial=activityRow('1h','tradeCount',0,'partial');
  assert.equal(exploreEmptyReason(activityState('1h','exploreMinTrades',[zero,unknown]))[0],activityHeadline);
  assert.equal(exploreEmptyReason(activityState('1h','exploreMinTrades',[zero,partial]))[0],activityHeadline);
});
test('UX-008 unknown activity preserves all combined criteria and literal unsafe-looking query text',()=>{
  const query='QA <img src=x onerror=alert(1)>';
  const s={...activityState('1h','exploreMinTrades',[activityRow('1h','tradeCount',null)]),exploreQuery:query,explorePromotion:'premier',exploreReward:'holder-fees'};
  const reason=exploreEmptyReason(s);
  assert.equal(reason[0],activityHeadline);assert.match(reason[1],/Search and active filters apply together/);
  assert.equal(reason[2],`Premier · Holder rewards · Minimum trades: 1 · Search: ${query}`);
  const known={...s,assets:[activityRow('1h','tradeCount',0)]};
  assert.equal(exploreEmptyReason(known)[0],'No tokens match this combination.');
  assert.equal(exploreEmptyReason(known)[2],reason[2]);
});
test('UX-008 quote, Favorites, Following, metadata-only and empty-feed precedence remain original',()=>{
  const unknown=activityState('1h','exploreMinVolumeUsd',[{}]);
  assert.match(exploreEmptyReason({...unknown,coinSolUsdPrice:null})[0],/conversion quote/);
  assert.match(exploreEmptyReason({...unknown,exploreTab:'favorites'},{getWatchlist:()=>[]})[0],/favorite tokens/);
  assert.match(exploreEmptyReason({...unknown,exploreTab:'following'},{getFollowingCoverage:()=>({total:0}),getFollowingTokenSources:()=>new Map()})[0],/followed wallets/);
  assert.equal(exploreEmptyReason({...unknown,assets:[]}),null);
  assert.equal(exploreEmptyReason({...state,assets:[{}],EXPLORE_CLUSTER:'devnet',exploreWindow:'1h',exploreQuery:'absent'})[0],'No token matches your search.');
  assert.equal(exploreEmptyReason({...state,assets:[{}],EXPLORE_CLUSTER:'devnet',exploreWindow:'1h',explorePromotion:'premier'})[0],'No Premier tokens match this view.');
  assert.match(exploreEmptyReason({...unknown,exploreTab:'favorites'},{getWatchlist:()=>['saved-missing']})[0],/Saved tokens are unavailable/);
  assert.match(exploreEmptyReason({...unknown,exploreTab:'following'},{getFollowingCoverage:()=>({total:2,checked:1,partial:1}),getFollowingTokenSources:()=>new Map()})[1],/Balance checks are incomplete/);
});
test('UX-008 inactive non-Devnet activity filters do not acquire new availability copy',()=>{
  assert.equal(exploreEmptyReason({...activityState('1h','exploreMinTrades',[{}]),EXPLORE_CLUSTER:'mainnet-beta'})[0],'No launch meets these trade-activity minimums.');
});
test('UX-008 empty analysis preserves source records and reads current controller window and cluster',()=>{
  const s=activityState('1h','exploreMinTrades',[activityRow('1h','tradeCount',null)]),before=structuredClone(s);
  exploreEmptyReason(s);assert.deepEqual(s,before);
  const calls=[];const app={...s,exploreEmptyReasonView:(current,deps)=>{calls.push({current,deps});return ['captured'];}};
  const controller=createExploreFiltersController(app);
  for(const period of activityPeriods){app.exploreWindow=period;app.EXPLORE_CLUSTER='devnet';assert.deepEqual(controller.exploreEmptyReason(),['captured']);assert.equal(calls.at(-1).current.exploreWindow,period);assert.equal(calls.at(-1).current.EXPLORE_CLUSTER,'devnet');assert.equal(calls.at(-1).current.assets,s.assets);}
  app.EXPLORE_CLUSTER='mainnet-beta';controller.exploreEmptyReason();assert.equal(calls.at(-1).current.EXPLORE_CLUSTER,'mainnet-beta');
});
