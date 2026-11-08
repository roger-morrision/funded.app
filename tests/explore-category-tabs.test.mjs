import test from 'node:test';
import assert from 'node:assert/strict';
import {createExploreFiltersController} from '../src/app/controllers/explore-filters.js';

function view(tab, policies = {}) {
  const state = {exploreTab:tab, EXPLORE_CLUSTER:'devnet', exploreQuery:'',
    exploreFilterOptions:()=>({}), filterMarketRecords:records=>records,
    verifiedLaunchPolicyForMint:mint=>policies[mint]};
  return createExploreFiltersController(state).filterExploreTabRecords;
}

test('promotion, paid listing and migrated tabs exclude unverified category claims',()=>{
  const records=[
    {address:'pro',promotionTier:'pro',benefitPolicyVerified:true},
    {address:'premier',promotionTier:'premier',benefitPolicyVerified:true},
    {address:'fake-pro',promotionTier:'pro'},
    {address:'paid',listingPayment:{verified:true,signature:'2'.repeat(64)}},
    {address:'unpaid',listingPayment:{signature:'2'.repeat(64)}},
    {address:'migrated',complete:true,migrated:true},
    {address:'curve-only',complete:true,migrated:false},
  ];
  for (const [tab,mint] of [['pro','pro'],['premier','premier'],['paid-list','paid'],['migrated','migrated']])
    assert.deepEqual(view(tab)(records).map(row=>row.address),[mint]);
});

test('New uses the last 12 hours of launch age, excluding future and paid-listing timestamps',t=>{
  const now=Date.parse('2026-11-08T12:00:00Z');
  t.mock.method(Date,'now',()=>now);
  const records=[
    {address:'recent',createdTimestamp:(now-3600000)/1000},
    {address:'boundary',createdTimestamp:now-12*3600000},
    {address:'old',createdTimestamp:now-12*3600000-1},
    {address:'future',createdTimestamp:now+1},
    {address:'listed',createdTimestamp:now-1000,listingPayment:{verified:true}},
    {address:'known-old',createdTimestamp:now-1000},
    {address:'unknown'},
  ];
  const filter=view('new',{'known-old':{blockTime:(now-24*3600000)/1000}});
  assert.deepEqual(filter(records).map(row=>row.address),['recent','boundary']);
});
