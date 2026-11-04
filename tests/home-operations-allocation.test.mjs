import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHomeKpiDashboard} from '../src/features/home/kpi-view.js';
import {formatSmallDashboardUsd} from '../src/features/shared/display.js';
import {savedFeeAllocationCopy,sharedFeeAllocationCopy} from '../src/features/fees/fee-policy-copy.js';
import {buildFeeDistributionPolicy} from '../distribution-policy.js';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';

function appAllocation(operationsLamports){
  const metrics=new Map();
  renderHomeKpiDashboard([],{assets:[],exploreUpdatedAt:1,coinSolUsdPrice:10,verifiedLaunchPoliciesStatus:'ready',EXPLORE_CLUSTER:'devnet'},
    {homeFeeAllocations:{status:'verified',settledCollections:1,appRevenueLamports:'20000000000',operationsLamports},
      document:{querySelector:()=>null},verifiedLaunchPolicyForMint:()=>null,setHomeDashboardMetric:(key,...args)=>metrics.set(key,args),
      currentCommunityClaimSummary:()=>({amount:'—',note:'Unavailable',state:'unavailable'}),renderFundedTokenLanding(){}});
  return metrics.get('app-revenue');
}

test('app revenue uses only verified operations rather than the combined reward and operations pool',()=>{
  const [value,note,state]=appAllocation('8000000000');
  assert.equal(value,formatSmallDashboardUsd(80));assert.notEqual(value,formatSmallDashboardUsd(200));
  assert.match(note,/Operations & marketing only/);assert.equal(state,'available');
  assert.equal(appAllocation('0')[2],'empty');
  for(const missing of[undefined,null,'not-an-amount']){
    const [amount,detail,status]=appAllocation(missing);assert.equal(amount,'$—');assert.equal(status,'unavailable');assert.match(detail,/Operations & marketing allocations unavailable/);
  }
});

test('fee summaries preserve the actual saved category rates and do not invent the published app rate',()=>{
  const shares={creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0},split=agencyProtocolSplit();
  const current=buildFeeDistributionPolicy(shares,{fundedSplit:split});
  assert.match(savedFeeAllocationCopy(current),/8% Operations & marketing/);assert.match(savedFeeAllocationCopy(current),/2% AI marketing/);
  const historical=buildFeeDistributionPolicy(shares,{fundedSplit:{...split,operationsPercent:30,communityPercent:30}});
  assert.match(savedFeeAllocationCopy(historical),/6% Operations & marketing/);assert.doesNotMatch(savedFeeAllocationCopy(historical),/8% Operations/);
  assert.doesNotMatch(savedFeeAllocationCopy({}),/8%|20%/);assert.doesNotMatch(sharedFeeAllocationCopy(),/20%.*(?:app|protocol)/i);
});
