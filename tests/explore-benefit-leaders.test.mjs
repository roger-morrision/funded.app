import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExploreBenefitLeaders } from '../src/features/explore/controls-view.js';

test('Explore rankings say "None yet" instead of 0% when no launch offers a benefit', () => {
  const container = {innerHTML:''};
  const document = {querySelector:selector => selector === '#explore-benefit-leaders' ? container : null};
  const records = [{address:'Mint1111',symbol:'AAA',benefitPolicyVerified:true,communityAirdropPercent:3,holderFeePercent:10,xFeePercent:0}];
  renderExploreBenefitLeaders(records,{exploreWindow:'24h',exploreSort:'volume'},{formatVerifiedPercent:n=>`${n}%`,formatExploreUsd:n=>`$${n}`,document});
  const xCard = container.innerHTML.split('<button').find(card => card.includes('data-explore-leader-sort="x-fee"'));
  assert.match(xCard,/data-state="empty"/);
  assert.match(xCard,/<strong>None yet<\/strong>/);
  assert.match(xCard,/<small>No launch offers this yet<\/small>/);
  assert.doesNotMatch(xCard,/0%/);
  assert.match(container.innerHTML,/<strong>3%<\/strong><small>AAA · of supply<\/small>/);
});
