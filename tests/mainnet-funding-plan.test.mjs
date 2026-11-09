import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMainnetFunding} from '../scripts/mainnet-funding-plan.mjs';
const costs={lockedLamports:4672995480,feeAllowanceLamports:25000000,marginLamports:250000000};
const plan={maximumTotalSpendLamports:'5000000000',minimumOperatingReserveLamports:'3000000000'};
test('unknown setup, liquidity and canary costs cannot certify the 5 SOL cap',()=>{
  const result=assessMainnetFunding(plan,costs);
  assert.equal(result.status,'incomplete');assert.equal(result.knownMaximumSpendLamports,'4947995480');
  assert.equal(result.remainingUnderCapLamports,'52004520');
  assert.equal(result.minimumFundingIncludingReserveLamports,'7947995480');
  assert.equal(result.missingEstimates.length,3);assert.equal(result.deploymentAuthorized,false);
  assert.equal(result.finalTransactionFeesVerified,false);assert.equal(result.payerBalanceVerified,false);
});
test('reserve is separate from spend, and known excess cannot be hidden by unknown costs',()=>{
  const result=assessMainnetFunding({...plan,initializationBudgetLamports:'100000000'},costs);
  assert.equal(result.status,'over-approved-cap');assert.equal(result.knownCostsWithinCap,false);
  assert.equal(result.remainingUnderCapLamports,'-47995480');
  const full=assessMainnetFunding({...plan,initializationBudgetLamports:'1',tokenLaunchAndLiquidityBudgetLamports:'0',canaryBudgetLamports:'1'},costs);
  assert.equal(full.status,'estimated-within-cap');assert.equal(full.deploymentAuthorized,false);
});
test('invalid or absent budget amounts remain missing rather than becoming zero',()=>{
  for(const invalid of [undefined,null,'','-1','0.5',5000000000]){
    const result=assessMainnetFunding({...plan,maximumTotalSpendLamports:invalid},costs);
    assert.equal(result.knownCostsWithinCap,null);assert(result.missingEstimates.includes('maximumTotalSpendLamports'));
  }
});
