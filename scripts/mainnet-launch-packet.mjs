import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PublicKey} from '@solana/web3.js';
import {loadMainnetConfig} from './mainnet-config.mjs';
import {mainnetReadinessPreflight} from './mainnet-readiness-preflight.mjs';
import {reviewedMainnetManifest} from '../mainnet-program.js';

const requiredCases=['admin-operations-withdrawal','launch-standard','launch-promotion','buy-and-sell',
  'collect-and-settle','creator-payout','holder-rewards','x-payout','protocol-payouts','buyback-burn',
  'community-claim','developer-unlock','recovery'];
const present=value=>typeof value==='string'&&value.trim().length>0&&!/REPLACE|PLACEHOLDER/i.test(value);
const key=value=>{try{return present(value)&&new PublicKey(value).toBase58()===value;}catch{return false;}};
const budget=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)&&BigInt(value)<=18446744073709551615n;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Read-only planning report. Recorded Devnet evidence is never promoted into
// a current acceptance result, independent review, or permission to spend SOL.
export async function buildMainnetLaunchPacket({plan,acceptance,manifest,config,devnetEvidence,sourceRevision,dirty=false}) {
  if(plan?.cluster!=='mainnet-beta'||acceptance?.cluster!=='mainnet-beta'
    ||plan.mainnetActivationAuthorized!==false||acceptance.mainnetActivationAuthorized!==false)
    throw Error('Preparation inputs must retain disabled Mainnet activation.');
  if(!/^[a-f0-9]{40}$/.test(sourceRevision||''))throw Error('An exact source revision is required.');
  const checks={freshInstall:plan.deploymentMode==='fresh-isolated-mainnet'&&plan.existingDevnetAction==='preserve'
      &&plan.copyDevnetFinancialState===false&&plan.reuseDevnetSigners===false,
    retainedUpgradeAuthority:plan.upgradeable===true&&acceptance.upgradeable===true,
    cleanSource:!dirty};
  const missing=[];
  for(const field of ['upgradeAuthority','mainnetProgramId','feeRecipient','fundedMint','fundedPool'])
    if(!key(plan[field]))missing.push(field);
  for(const field of ['mainnetAppOrigin','productionRpcSecretPath','deploymentPayerSignerReference',
    'productionDatabaseSecretPath','metadataSecretPath','independentReviewer','independentReviewReference'])
    if(!present(plan[field]))missing.push(field);
  for(const group of ['freshInfrastructure','freshSignerReferences']){
    const fields=group==='freshInfrastructure'?['databaseReference','cacheReference','metadataNamespace','appDeploymentReference','backupReference']
      :['automationAuthority','priceAttestation','operationsTreasury','tradeFeeTreasury','boostTreasury','revenueTreasury'];
    for(const field of fields)if(!present(plan[group]?.[field]))missing.push(`${group}.${field}`);
  }
  checks.boundedSpend=budget(plan.maximumTotalSpendLamports)
    &&(plan.maximumPriorityFeeLamports==='0'||budget(plan.maximumPriorityFeeLamports))
    &&BigInt(plan.maximumPriorityFeeLamports)<BigInt(plan.maximumTotalSpendLamports)
    &&acceptance.maximumTotalSpendLamports===plan.maximumTotalSpendLamports
    &&acceptance.maximumPriorityFeeLamports===plan.maximumPriorityFeeLamports;
  const reviewed=reviewedMainnetManifest(manifest);
  checks.reviewedExactRelease=Boolean(reviewed&&reviewed.sourceRevision===sourceRevision
    &&reviewed.programId===plan.mainnetProgramId&&reviewed.upgradeAuthority===plan.upgradeAuthority
    &&reviewed.fundedMint===plan.fundedMint&&reviewed.fundedPool===plan.fundedPool
    &&reviewed.independentReview.reviewer===plan.independentReviewer
    &&reviewed.independentReview.reference===plan.independentReviewReference
    &&acceptance.releaseRevision===sourceRevision&&acceptance.programId===reviewed.programId
    &&acceptance.programDataSha256===reviewed.programDataSha256&&acceptance.upgradeAuthority===reviewed.upgradeAuthority
    &&acceptance.payerSignerReference===plan.deploymentPayerSignerReference
    &&acceptance.independentReviewer===plan.independentReviewer
    &&acceptance.independentReviewReference===plan.independentReviewReference);
  const specified=acceptance.requiredCases?.map(row=>row.id)||[];
  checks.completeAcceptancePlan=specified.length===requiredCases.length&&new Set(specified).size===specified.length
    &&requiredCases.every(id=>specified.includes(id));
  const evidenceValid=devnetEvidence?.cluster==='devnet'&&devnetEvidence.schemaVersion===1
    &&/^[a-f0-9]{40}$/.test(devnetEvidence.application?.revision||'');
  const recorded=requiredCases.map(id=>{
    const rows=evidenceValid?devnetEvidence.acceptance?.filter(row=>row.id===id)||[]:[];
    const row=rows.length===1?rows[0]:null;
    return {id,recordedStatus:row?.status||'unavailable',currentReleaseVerified:false,
      action:row?.status==='passed-live'?'Revalidate against the final release and retain finalized deltas.':row?.detail||'Run the complete acceptance case.'};
  });
  const preflight=await mainnetReadinessPreflight(config);
  return {schemaVersion:1,generatedAt:new Date().toISOString(),status:'no-go',ready:false,
    mainnetActivationAuthorized:false,scope:'offline-planning-not-live-acceptance',
    source:{revision:sourceRevision,dirty},checks,missingProductionInputs:missing,
    configuration:preflight.configuration,
    reviewedRelease:checks.reviewedExactRelease?'matching-review-record':'blocked',
    devnetEvidence:{status:evidenceValid?'historical-record-not-reverified':'unavailable',
      revision:evidenceValid?devnetEvidence.application.revision:null,
      sha256:evidenceValid?sha(devnetEvidence):null,cases:recorded},
    remainingCodeGates:preflight.remainingCodeGates,
    nextSteps:['Finish network integration and exercise all financial/recovery cases on Devnet.',
      'Replace production placeholders with isolated infrastructure and public identity/secret references.',
      'Freeze final bytes; obtain independent review and refresh rent, fees and total budget.',
      'Approve the exact program deployment and capped canary; verify finalized state before public activation.'],
    rollback:acceptance.rollback};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(!['--config','--evidence','--output'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]])
      throw Error('Use [--config FILE] [--evidence FILE] [--output FILE]. This command never deploys or signs.');
    options[args[i]]=args[++i];
  }
  const read=path=>JSON.parse(readFileSync(path,'utf8'));
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
  const report=await buildMainnetLaunchPacket({plan:read('config/mainnet-deployment-plan.json'),
    acceptance:read('config/mainnet-acceptance-plan.json'),manifest:read('config/mainnet-program-release.json'),
    config:loadMainnetConfig(options['--config']||'config/mainnet-staging.example'),
    devnetEvidence:options['--evidence']?read(options['--evidence']):null,sourceRevision,dirty});
  if(options['--output'])writeFileSync(options['--output'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
  process.exitCode=1; // The packet cannot authorize deployment or runtime writes.
}
