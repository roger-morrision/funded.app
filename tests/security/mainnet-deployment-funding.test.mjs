import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assessMainnetFunding} from '../../scripts/mainnet-funding-plan.mjs';
import {prepareMainnetDeployment} from '../../scripts/prepare-mainnet-deployment.mjs';
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

test('read-only cost planner distinguishes selected identity from final release approval',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'funded-mainnet-plan-'));
  try{
    const bytes=Buffer.from([0x7f,0x45,0x4c,0x46]);await writeFile(join(dir,'candidate.so'),bytes);
    const plan={...read('config/mainnet-deployment-plan.json'),sourceRevision:'a'.repeat(40),
      referenceArtifacts:[{file:'candidate.so',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),deployEligible:false}]};
    const selected=await prepareMainnetDeployment(plan,{artifactDir:dir});
    assert.equal(selected.ready,false);assert.equal(selected.mainnetActivationAuthorized,false);
    assert.match(selected.remainingGates[0],/selected program identity.*integrated App\/ELF\/CI binding/);
    const missing=await prepareMainnetDeployment({...plan,mainnetProgramId:null},{artifactDir:dir});
    assert.match(missing.remainingGates[0],/Select and review an actual production program identity/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
