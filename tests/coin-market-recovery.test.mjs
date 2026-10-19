import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinStateController } from '../src/app/controllers/coin-state.js';
import { renderCoinPricePath } from '../src/features/coin/chart-view.js';

function fixture(failures) {
  const panel={innerHTML:''},fields=new Map(),now=Math.floor(Date.now()/1000);
  const market={cluster:'devnet',coverage:'complete',poolHistoryCoverage:'complete',
    poolTradeCount24h:2,tradeCount24h:2,buyCount24h:1,sellCount24h:1,
    volume24hSol:0.2,buyVolume24hSol:0.1,sellVolume24hSol:0.1,
    recentTrades:[{side:'buy',priceRatio:2,blockTime:now-10},
      {side:'sell',priceRatio:1,blockTime:now-20}]};
  let calls=0;
  const document={querySelector:selector=>selector==='#coin-price-path'?panel:null,querySelectorAll:()=>[]};
  const state={coinLoadId:1,EXPLORE_CLUSTER:'devnet',coinMarketActivity:{status:'loading'},
    coinSolUsdValues:{supply:1000},coinSolUsdPrice:100,
    coinChartPeriod:'6h',coinChartMetric:'mcap',coinChartUnit:'usd',
    apiRequest:async(_path,options)=>{
      assert(options.signal instanceof AbortSignal);
      const failure=failures[calls++];
      if (typeof failure==='function') return failure(state);
      if (failure) throw failure;
      return {available:true,data:market};
    },
    setCoinField:(selector,value)=>fields.set(selector,value),formatCoinUsd:value=>`$${value*100}`,
    renderCoinPricePath:()=>renderCoinPricePath(state,{document,formatCoinSnapshotUsd:value=>`$${value*100}`}),
    renderCoinSummary:()=>{},renderCoinFlow:()=>{},renderCoinPulse:()=>{},
    setCoinTabLabels:()=>{},renderCoinActivityTab:()=>{}};
  return {state,fields,panel,calls:()=>calls,
    run:()=>createCoinStateController(state).loadCoinMarketActivity('qa-mint',1,6,true)};
}

for (const failure of [new DOMException('Timed out','TimeoutError'),Object.assign(new Error('Unavailable'),{status:502})]) {
  test(`transient ${failure.name}/${failure.status||'transport'} failure recovers chart and trade data once`,async()=>{
    const f=fixture([failure]);await f.run();
    assert.equal(f.calls(),2);assert.equal(f.state.coinMarketActivity.status,'ready');
    assert.equal(f.fields.get('#coin-trade-count'),'2');
    assert.equal(f.fields.get('#coin-trade-breakdown'),'1 buys · 1 sells');
    assert.match(f.panel.innerHTML,/<svg/);
  });
}

test('two failed scans remain unavailable instead of displaying fabricated zero trades',async()=>{
  const failure=Object.assign(new Error('Unavailable'),{status:503});
  const f=fixture([failure,failure]);await f.run();
  assert.equal(f.calls(),2);assert.equal(f.state.coinMarketActivity.status,'unavailable');
  assert.equal(f.fields.get('#coin-trade-count'),'Unavailable');
  assert.match(f.panel.innerHTML,/Chart unavailable/);assert.doesNotMatch(f.panel.innerHTML,/<svg/);
});

test('navigation cancels retry and prevents the old token from updating the next token',async()=>{
  const f=fixture([state=>{state.coinLoadId++;throw new Error('Old request failed');}]);await f.run();
  assert.equal(f.calls(),1);assert.equal(f.fields.size,0);assert.equal(f.panel.innerHTML,'');
});

test('permanent request errors do not trigger an automatic retry',async()=>{
  const f=fixture([Object.assign(new Error('Invalid mint'),{status:400})]);await f.run();
  assert.equal(f.calls(),1);assert.equal(f.state.coinMarketActivity.status,'unavailable');
});
