import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCoinPulse} from '../src/features/coin/pulse-view.js';
test('trade panel distinguishes indexed totals, sampled traders and estimated volume splits',()=>{
  const nodes=new Map();const document={querySelector:selector=>{
    if(!nodes.has(selector))nodes.set(selector,{textContent:'',style:{}});return nodes.get(selector);
  },querySelectorAll:()=>[]};
  renderCoinPulse({coinPulsePeriod:'24h',coinMarketActivity:{status:'ready',graduated:true,activityWindows:{'24h':{
    coverage:'partial',sampleCount:300,indexedCounts:true,indexedVolume:true,volumeSplitEstimated:true,
    tradeCount:55543,traderCount:177,volumeSol:100,buyVolumeSol:60,sellVolumeSol:40,largestTradeSol:2,buyCount:31481,sellCount:24062,
  }}}},{document,formatExploreUsd:(value,{partial})=>`${partial?'≥':''}$${value}`});
  assert.equal(nodes.get('#coin-pulse-traders').textContent,'≥177');
  assert.equal(nodes.get('#coin-pulse-trades').textContent,Number(55543).toLocaleString());
  assert.equal(nodes.get('#coin-pulse-volume').textContent,'$100');
  assert.equal(nodes.get('#coin-pulse-buy-volume').textContent,'≈$60');
  assert.equal(nodes.get('#coin-pulse-largest').textContent,'≥$2');
  assert.equal(nodes.get('#coin-pulse-note').hidden,false);
  assert.match(nodes.get('#coin-pulse-note').textContent,/300 sampled trades, not the full 24h total/);
});
