import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessMainnetFunding} from '../../scripts/mainnet-funding-plan.mjs';
import {buildMainnetLaunchPacket} from '../../scripts/mainnet-launch-packet.mjs';
import {loadMainnetConfig} from '../../scripts/mainnet-config.mjs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));

test('uncapped deployment still reports required funding and missing estimates',()=>{
  const plan=read('config/mainnet-deployment-plan.json');
  const costs={lockedLamports:5_464_378_200n,feeAllowanceLamports:25_000_000n,marginLamports:250_000_000n};
  const incomplete=assessMainnetFunding(plan,costs);
  assert.equal(incomplete.status,'incomplete');
  assert.equal(incomplete.approvedSpendCapLamports,null);
  assert.equal(incomplete.knownCostsWithinCap,null);
  assert.deepEqual(incomplete.missingEstimates,[
    'initializationBudgetLamports','tokenLaunchAndLiquidityBudgetLamports','canaryBudgetLamports']);
  assert.equal(incomplete.minimumFundingIncludingReserveLamports,'8739378200');

  const quoted={...plan,initializationBudgetLamports:'50000000',
    tokenLaunchAndLiquidityBudgetLamports:'1000000000',canaryBudgetLamports:'50000000'};
  const estimate=assessMainnetFunding(quoted,costs);
  assert.equal(estimate.status,'estimated-no-cap');
  assert.equal(estimate.minimumFundingIncludingReserveLamports,'9839378200');
  assert.deepEqual(estimate.missingEstimates,[]);
  assert.equal(assessMainnetFunding({...quoted,maximumTotalSpendLamports:'invalid'},costs).status,'incomplete');
});

test('release packet accepts uncapped planning but cannot authorize Mainnet',async()=>{
  const plan=read('config/mainnet-deployment-plan.json');
  const acceptance=read('config/mainnet-acceptance-plan.json');
  const manifest=read('config/mainnet-program-release.json');
  const config=loadMainnetConfig('config/mainnet-staging.example');
  const input={plan,acceptance,manifest,config,devnetEvidence:null,sourceRevision:'a'.repeat(40)};
  const packet=await buildMainnetLaunchPacket(input);
  assert.equal(packet.checks.uncappedDeploymentSpend,true);
  assert.equal(packet.checks.configuredSpend,true);
  assert.equal(packet.ready,false);
  assert.equal(packet.mainnetActivationAuthorized,false);
  assert.equal(packet.reviewedRelease,'blocked');

  const obsoleteCap=await buildMainnetLaunchPacket({...input,config:{...config,MAINNET_MAXIMUM_TOTAL_SPEND_LAMPORTS:'5000000000'}});
  assert.equal(obsoleteCap.checks.configuredSpend,false);
});
