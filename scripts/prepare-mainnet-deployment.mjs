// Read-only preparation. No signer loading, transaction submission or deployment.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Connection} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {rentExempt} from './estimate-program-deploy-cost.mjs';

const sol=lamports=>Number((lamports/1_000_000_000).toFixed(9));
const safeInteger=value=>Number.isSafeInteger(value)&&value>=0;
export async function prepareMainnetDeployment(plan,{artifactDir,connection,now=()=>new Date()}={}){
  assert.equal(plan.schemaVersion,1);assert.equal(plan.cluster,'mainnet-beta');
  assert.equal(plan.genesisHash,SOLANA_GENESIS['mainnet-beta']);
  assert.equal(plan.mainnetActivationAuthorized,false,'Preparation must not authorize deployment.');
  assert.equal(plan.targetLayout,'merged-v3');
  assert(/^[a-f0-9]{40}$/.test(plan.sourceRevision));
  assert(plan.referenceArtifacts?.length>0);assert(safeInteger(plan.feeAllowanceLamports)&&safeInteger(plan.deploymentMarginLamports));
  const root=resolve(artifactDir),artifacts=plan.referenceArtifacts.map(row=>{
    assert.equal(row.deployEligible,false,'Reference artifacts cannot be approved by the cost planner.');
    const path=resolve(root,row.file),rel=relative(root,path);
    assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Artifact escapes the selected directory.');
    const bytes=fs.readFileSync(path),sha256=createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.length,row.bytes,'Artifact size differs from the recorded build.');
    assert.equal(sha256,row.sha256,'Artifact hash differs from the recorded build.');
    assert(bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])),'Expected a compiled ELF artifact.');
    return {...row,artifactVerified:true};
  });
  let slot=null;
  if(connection){
    assert.equal(await connection.getGenesisHash(),plan.genesisHash,'RPC is not Mainnet; no quote accepted.');
    slot=await connection.getSlot('finalized');assert(Number.isSafeInteger(slot)&&slot>0);
  }
  const cache=new Map(),rent=async bytes=>{
    if(!cache.has(bytes)){
      const value=connection?await connection.getMinimumBalanceForRentExemption(bytes,'finalized'):rentExempt(bytes);
      assert(safeInteger(value),'Invalid rent quote.');cache.set(bytes,value);
    }
    return cache.get(bytes);
  };
  const programRent=await rent(36),rows=[];
  for(const row of artifacts){
    const programDataRent=await rent(45+row.bytes),bufferRent=await rent(37+row.bytes);
    const locked=programRent+programDataRent;
    // Allow 900 bytes/write and two signatures; actual CLI fees depend on the
    // final signer layout, prioritization, message size and retransmissions.
    const estimatedBaseFees=(Math.ceil(row.bytes/900)*2+6)*5000;
    const feeAllowance=Math.max(plan.feeAllowanceLamports,estimatedBaseFees);
    const suggested=Math.ceil((locked+feeAllowance+plan.deploymentMarginLamports)/1_000_000_000)*1_000_000_000;
    rows.push({...row,maxLen:row.bytes,programRentLamports:programRent,programDataRentLamports:programDataRent,
      bufferRentLamports:bufferRent,lockedLamports:locked,
      freshDeploymentFundingBeforeFeesLamports:locked,estimatedBaseFeeLamports:estimatedBaseFees,
      feeAllowanceLamports:feeAllowance,deploymentMarginLamports:plan.deploymentMarginLamports,
      suggestedWalletLamports:suggested,
      sol:{locked:sol(locked),buffer:sol(bufferRent),estimatedBaseFees:sol(estimatedBaseFees),suggestedWallet:sol(suggested)}});
  }
  const required=['upgradeAuthority','mainnetProgramId','mainnetAppOrigin','productionRpcSecretPath',
    'deploymentPayerSignerReference','productionDatabaseSecretPath','metadataSecretPath','feeRecipient','fundedMint'];
  return {schemaVersion:1,status:'prepared-not-deployable',ready:false,mainnetActivationAuthorized:false,
    contractSourceRevision:plan.sourceRevision,ciRun:plan.ciRun,cluster:plan.cluster,genesisHash:plan.genesisHash,
    quote:{status:connection?'live-mainnet-rent':'offline-assumption',checkedAt:now().toISOString(),finalizedSlot:slot,
      ...(connection?{}:{lamportsPerByteAssumption:5080}),feeStatus:'estimate-plus-allowance; refresh against the final messages before signing'},
    layout:{physicalPrograms:1,roles:plan.roles,legacyRouterRequired:false,separateEscrowRequired:false},rows,
    fundingModel:'Fresh Loader-v3 deployment returns the buffer lamports to the same payer before funding ProgramData. Do not add buffer rent twice. Assumes exact allocation, one program, no abandoned buffers and the same deployment payer.',
    missingInputs:required.filter(key=>!plan[key]),
    remainingGates:['Select and review an actual production program identity and build; reference binaries are not Mainnet releases.',
      'Implement and verify production network paths, agency custody, metadata, launch registration and financial workers.',
      'Verify isolated infrastructure, independent custody review, deployment spend cap and explicit Mainnet approval.',
      'Verify finalized deployed bytes and initialize state, then run an approved capped canary before enabling writes.'],
    excludedCosts:plan.excludedCosts,sequence:plan.sequence,
    sources:{loader:'https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L260-L280',
      cli:'https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L2433-L2551',
      deployment:'https://solana.com/docs/core/programs/program-deployment'}};
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--online'){options.online=true;continue;}
    assert(['--plan','--artifact-dir','--output'].includes(key)&&args[i+1]&&!args[i+1].startsWith('--'),'Use --artifact-dir PATH [--plan PATH] [--output PATH] [--online].');
    options[key.slice(2)]=args[++i];
  }
  assert(options['artifact-dir'],'Provide the directory of downloaded CI artifacts.');
  const plan=JSON.parse(fs.readFileSync(options.plan||'config/mainnet-deployment-plan.json','utf8'));
  const connection=options.online?new Connection('https://api.mainnet-beta.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}):undefined;
  const report=await prepareMainnetDeployment(plan,{artifactDir:options['artifact-dir'],connection});
  if(options.output){fs.mkdirSync(dirname(resolve(options.output)),{recursive:true});fs.writeFileSync(options.output,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({status:report.status,quote:report.quote,rows:report.rows.map(row=>({variant:row.variant,bytes:row.bytes,...row.sol})),missingInputs:report.missingInputs},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{
  console.error('Mainnet preparation failed: verify the plan, artifact hashes and read-only RPC. No transactions were sent.');process.exitCode=1;
});
