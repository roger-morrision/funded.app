import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExplorePulse } from '../src/features/explore/status-view.js';
import { renderExplorePayoutStats } from '../src/features/explore/controls-view.js';

test('Explore loading resolves for a successful empty feed and preserves outage messages', () => {
  const scope = {textContent:''};
  const selected = new Map();
  const lanes = ['all', 'launch', 'almost', 'migrated'].map(exploreLane => ({
    dataset:{exploreLane},
    classList:{toggle(name, active){ if (name === 'active') selected.set(exploreLane, active); }},
    setAttribute(name, value){ if (name === 'aria-pressed') selected.set(`${exploreLane}:pressed`, value); },
  }));
  const document = {querySelector:()=>scope,querySelectorAll:()=>lanes};
  const state = {exploreLastVerifiedAt:null,exploreUpdatedAt:null,exploreFeedAvailable:false,
    exploreProviderStatus:'On-chain only · loading',exploreTab:'new',exploreNewLane:'all'};
  const render = () => renderExplorePulse([],state,{document});
  render(); assert.match(scope.textContent,/Checking/);
  assert.equal(selected.get('all:pressed'),'true');
  Object.assign(state,{exploreUpdatedAt:'2026-10-10T00:00:00Z',exploreFeedAvailable:true,exploreProviderStatus:'No indexed launches'});
  state.exploreNewLane = 'migrated';
  render(); assert.equal(scope.textContent,'Stages confirmed on-chain.');
  assert.equal(selected.get('migrated:pressed'),'true');
  assert.equal(selected.get('all:pressed'),'false');
  Object.assign(state,{exploreFeedAvailable:false,exploreProviderStatus:'Launch feed unavailable'});
  render(); assert.equal(scope.textContent,'Launch stages unavailable.');
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
