import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExplorePulse } from '../src/features/explore/status-view.js';
import { renderExplorePayoutStats } from '../src/features/explore/controls-view.js';

test('Explore loading resolves for a successful empty feed and preserves outage messages', () => {
  const count = {textContent:''}, detail = {textContent:''};
  const lane = {dataset:{exploreLane:'launch'},querySelector: selector => selector === 'strong' ? count : detail,
    classList:{toggle(){}},setAttribute(){}};
  const document = {querySelector:()=>null,querySelectorAll:()=>[lane]};
  const state = {exploreLastVerifiedAt:null,exploreUpdatedAt:null,exploreFeedAvailable:false,
    exploreProviderStatus:'On-chain only · loading',exploreTab:'new',exploreNewLane:'launch'};
  const render = () => renderExplorePulse([],state,{document});
  render(); assert.match(detail.textContent,/Waiting/);
  Object.assign(state,{exploreUpdatedAt:'2026-10-10T00:00:00Z',exploreFeedAvailable:true,exploreProviderStatus:'No indexed launches'});
  render(); assert.equal(count.textContent,'00'); assert.equal(detail.textContent,'No confirmed launches in this stage');
  Object.assign(state,{exploreFeedAvailable:false,exploreProviderStatus:'Launch feed unavailable'});
  render(); assert.equal(detail.textContent,'Verified feed unavailable'); assert.equal(count.textContent,'—');
});

test('Payout summary completion never leaves absent groups in the loading state', () => {
  const container={innerHTML:''};
  const state={analyticsSummary:null,EXPLORE_CLUSTER:'devnet'};
  const render=()=>renderExplorePayoutStats(state,{document:{querySelector:()=>container},formatPayoutSol:()=> '0'});
  render(); assert.match(container.innerHTML,/Checking finalized/);
  state.analyticsSummary={feePayoutStats:{cluster:'devnet',commitment:'finalized',creator:{status:'verified',paidLamports:'0',payoutCount:0}}};
  render(); assert.doesNotMatch(container.innerHTML,/Checking|data-state="loading"/);
  assert.match(container.innerHTML,/0 finalized payments/);assert.match(container.innerHTML,/Finalized payout data unavailable/);
  state.analyticsSummary={feePayoutStats:{cluster:'mainnet-beta',commitment:'finalized'}};
  render(); assert.doesNotMatch(container.innerHTML,/Checking|data-state="loading"/);
  assert.match(container.innerHTML,/data-state="unavailable"/);
});
