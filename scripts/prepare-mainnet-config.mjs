// Preparation only: no secret reads, signer construction, RPC or deployment.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {assertMainnetStagingPolicy} from '../server/mainnet-staging-policy.mjs';

const supplied=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&!/REPLACE|PLACEHOLDER|[\r\n"\x00]/i.test(value);
const key=value=>{try{return supplied(value)&&new PublicKey(value).toBase58()===value;}catch{return false;}};
const secretNames=['SOLANA_RPC_URL','DEVNET_SOLANA_RPC_URL','DATABASE_URL','DEVNET_DATABASE_URL',
  'BIRDEYE_API_KEY','PINATA_JWT','FUNDED_API_TOKEN'];

export function prepareMainnetConfig(plan,template,{root=process.cwd(),outputFile}={}) {
  if(plan?.schemaVersion!==1||plan.cluster!=='mainnet-beta'||plan.genesisHash!==SOLANA_GENESIS['mainnet-beta']
    ||plan.mainnetActivationAuthorized!==false||plan.deploymentMode!=='fresh-isolated-mainnet'
    ||plan.copyDevnetFinancialState!==false||plan.reuseDevnetSigners!==false)
    throw Error('An isolated Mainnet preparation plan with activation disabled is required.');
  assertMainnetStagingPolicy(template);
  if(template.SOLANA_CLUSTER!=='mainnet-beta'||template.VITE_SOLANA_CLUSTER!=='mainnet-beta')
    throw Error('The template must explicitly select Mainnet for server and browser.');
  for(const name of secretNames)if(template[name])throw Error(`Use ${name}_FILE, not credential values in the template.`);
  for(const name of ['mainnetProgramId','upgradeAuthority','adminWallet','fundedMint','fundedPool','feeRecipient'])
    if(!key(plan[name]))throw Error(`A canonical public identity is required: ${name}`);
  const identities=plan.selectedPublicIdentities;
  for(const role of ['automationOperator','offlineGuardian','priceAttestor'])
    if(!key(identities?.[role]))throw Error(`A public production custody identity is required: ${role}`);
  if(!key(identities?.deploymentPayer)||identities.program!==plan.mainnetProgramId
    ||identities.adminUpgrade!==plan.upgradeAuthority||identities.primaryMint!==plan.fundedMint
    ||identities.primaryPool!==plan.fundedPool||plan.upgradeAuthority!==plan.adminWallet
    ||new Set([identities.deploymentPayer,plan.mainnetProgramId,plan.upgradeAuthority]).size!==3)
    throw Error('Selected payer, program, assets and upgrade authority must match the plan.');
  for(const name of ['productionRpcSecretPath','productionDatabaseSecretPath','metadataSecretPath','deploymentPayerSignerReference'])
    if(!supplied(plan[name]))throw Error(`A file reference is required: ${name}`);
  const origin=new URL(plan.mainnetAppOrigin);
  if(origin.protocol!=='https:'||origin.origin!==plan.mainnetAppOrigin)
    throw Error('Mainnet requires an HTTPS application origin.');
  if(plan.maximumTotalSpendLamports!==null||!/^\d+$/.test(plan.maximumPriorityFeeLamports))
    throw Error('The explicit deployment funding policy is required.');
  const reference=value=>{
    // Plan references are repository-relative; POSIX host paths remain host paths.
    const absolute=isAbsolute(value)||value.startsWith('/')?value:resolve(root,value);
    return absolute.replaceAll('\\','/');
  };
  const env={...template,SOLANA_CLUSTER:'mainnet-beta',VITE_SOLANA_CLUSTER:'mainnet-beta',
    VITE_EXPLORE_CLUSTER:'mainnet-beta',VITE_MAINNET_READ_ONLY:'true',VITE_ALLOW_MAINNET:'false',
    MAINNET_PROGRAM_LAYOUT:'merged-v3',MAINNET_APP_ORIGIN:plan.mainnetAppOrigin,
    VITE_API_BASE_URL:'/',FUNDED_SKIP_LOCAL_ENV:'true',
    MAINNET_APPROVED_UPGRADE_AUTHORITY:plan.upgradeAuthority,FUNDED_ADMIN_WALLETS:plan.adminWallet,
    FUNDED_V3_OPERATOR_PUBLIC_KEY:identities.automationOperator,FUNDED_V3_GUARDIAN_PUBLIC_KEY:identities.offlineGuardian,
    FUNDED_V3_PRICE_ATTESTOR_PUBLIC_KEY:identities.priceAttestor,
    MAINNET_APPROVED_IMMUTABLE_PROGRAM:'false',MAINNET_MAXIMUM_PRIORITY_FEE_LAMPORTS:plan.maximumPriorityFeeLamports,
    FUNDED_FEE_ROUTER_PROGRAM_ID:plan.mainnetProgramId,VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:plan.mainnetProgramId,
    FUNDED_V3_FEE_ROUTER_PROGRAM_ID:plan.mainnetProgramId,FUNDED_DEVELOPER_LOCK_PROGRAM_ID:plan.mainnetProgramId,
    FUNDED_TOKEN_MINT:plan.fundedMint,VITE_FUNDED_TOKEN_MINT:plan.fundedMint,
    FUNDED_SWAP_POOL:plan.fundedPool,VITE_FUNDED_SWAP_POOL:plan.fundedPool,
    FUNDED_TRADE_FEE_OWNER:plan.feeRecipient,VITE_FUNDED_TRADE_FEE_OWNER:plan.feeRecipient,
    SOLANA_RPC_URL_FILE:reference(plan.productionRpcSecretPath),DATABASE_URL_FILE:reference(plan.productionDatabaseSecretPath),
    METADATA_STORAGE:'pinata',PINATA_JWT_FILE:reference(plan.metadataSecretPath),
    MAINNET_DEPLOYMENT_PAYER_SIGNER_REFERENCE:plan.deploymentPayerSignerReference};
  // A review-candidate ELF hash is not the finalized full ProgramData hash.
  for(const name of ['FUNDED_REWARD_PROGRAM_DATA_SHA256','FUNDED_V3_PROGRAM_DATA_SHA256','FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256'])
    env[name]='REPLACE_WITH_REVIEWED_FINALIZED_PROGRAMDATA_HASH';
  delete env.MAINNET_MAXIMUM_TOTAL_SPEND_LAMPORTS;
  assertMainnetStagingPolicy(env);
  const missing=Object.entries(env).filter(([,v])=>/REPLACE|PLACEHOLDER/i.test(v)).map(([k])=>k);
  const text='# Generated preparation only. No signing or activation is authorized.\n'
    +'# Secret references only; complete host-specific references before running staging.\n'
    +Object.entries(env).map(([name,value])=>{
      if(!/^[A-Z][A-Z0-9_]*$/.test(name)||/[\r\n"\x00]/.test(value))throw Error('Invalid configuration field.');
      return `${name}="${value}"`;
    }).join('\n')+'\n';
  return {env,text,report:{status:'prepared-not-deployable',mainnetActivationAuthorized:false,
    outputFile:outputFile?resolve(outputFile):null,missingSettings:missing,
    deploymentPayer:identities.deploymentPayer,feeRecipient:plan.feeRecipient,
    metadataCredentialReference:env.PINATA_JWT_FILE,secretContentsRead:false}};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [flag,output,...extra]=process.argv.slice(2);
  if(flag!=='--output'||!output||extra.length)throw Error('Use --output NEW_PRIVATE_ENV_FILE. Existing files are never overwritten.');
  const plan=JSON.parse(readFileSync('config/mainnet-deployment-plan.json','utf8'));
  const result=prepareMainnetConfig(plan,parseEnv(readFileSync('config/mainnet-staging.example','utf8')),{outputFile:output});
  // The caller must choose/create the intended private directory.
  writeFileSync(resolve(output),result.text,{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result.report,null,2));
}
