import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseEnv} from 'node:util';
import {prepareMainnetConfig} from '../../scripts/prepare-mainnet-config.mjs';
import {loadMainnetConfig} from '../../scripts/mainnet-config.mjs';
import {buildMainnetLaunchPacket} from '../../scripts/mainnet-launch-packet.mjs';
import {assessMainnetConfig} from '../../scripts/mainnet-readiness-preflight.mjs';

const read=file=>JSON.parse(readFileSync(file,'utf8'));
const plan=read('config/mainnet-deployment-plan.json');
const template=parseEnv(readFileSync('config/mainnet-staging.example','utf8'));
const prepare=(p=plan,t=template)=>prepareMainnetConfig(p,t);

test('Mainnet preparation binds existing public settings without enabling runtime writes',()=>{
  const {env,text,report}=prepare();
  assert.deepEqual({...parseEnv(text)},env);
  assert.equal(env.FUNDED_TRADE_FEE_OWNER,plan.feeRecipient);
  assert.equal(env.VITE_FUNDED_TRADE_FEE_OWNER,plan.feeRecipient);
  assert.equal(env.MAINNET_DEPLOYMENT_PAYER_SIGNER_REFERENCE,plan.deploymentPayerSignerReference);
  assert.equal(env.FUNDED_ADMIN_WALLETS,plan.adminWallet);
  assert.equal(env.PINATA_JWT_FILE,resolve(plan.metadataSecretPath).replaceAll('\\','/'));
  assert.equal(env.VITE_ALLOW_MAINNET,'false');
  assert.equal(env.VITE_MAINNET_READ_ONLY,'true');
  assert.equal(env.FUNDED_V3_LAUNCH_ENABLED,'false');
  assert.equal(env.FUNDED_V3_PROGRAM_DATA_SHA256,'REPLACE_WITH_REVIEWED_FINALIZED_PROGRAMDATA_HASH');
  assert.equal(assessMainnetConfig(env).configurationComplete,false);
  assert.equal(report.secretContentsRead,false);
  assert.equal(report.mainnetActivationAuthorized,false);
});

test('Mainnet preparation rejects activation, signer settings, credentials and mismatched identities',()=>{
  for(const changed of [{mainnetActivationAuthorized:true},{reuseDevnetSigners:true},{copyDevnetFinancialState:true},
    {cluster:'devnet'},{feeRecipient:'REPLACE_FEE_OWNER'},{mainnetProgramId:plan.feeRecipient},
    {selectedPublicIdentities:{...plan.selectedPublicIdentities,deploymentPayer:plan.mainnetProgramId}}])
    assert.throws(()=>prepare({...plan,...changed}));
  for(const changed of [{FUNDED_V3_LAUNCH_ENABLED:'true'},{FUNDED_ADMIN_TRADE_FEE_SIGNER_FILE:'key.json'},
    {PINATA_JWT:'credential-fixture'},{SOLANA_CLUSTER:'devnet'},{NODE_OPTIONS:'--import hook.mjs'}])
    assert.throws(()=>prepare(plan,{...template,...changed}));
});

test('Mainnet loader resolves metadata references and never reads the deployment payer key',()=>{
  const dir=resolve('tmp/mainnet-config-fixture'),file=join(dir,'staging.env');
  const {env}=prepare();
  env.PINATA_JWT_FILE='../metadata-token';
  const text=Object.entries(env).map(([k,v])=>`${k}="${v}"`).join('\n');
  const reads=[];
  const loaded=loadMainnetConfig(file,{read:path=>{
    reads.push(path);
    if(path===file)return text;
    assert.notEqual(path,resolve(plan.deploymentPayerSignerReference));
    return 'mocked-non-signer-credential';
  }});
  assert.equal(loaded.PINATA_JWT_FILE,resolve(dir,'../metadata-token'));
  assert.equal(loaded.PINATA_JWT,'mocked-non-signer-credential');
  assert(reads.includes(loaded.PINATA_JWT_FILE));
  assert(!reads.some(path=>path.includes('deployment-payer-keypair')));
});

test('Mainnet packet rejects fee, payer and metadata configuration drift',async()=>{
  const {env}=prepare();
  const input={plan,acceptance:read('config/mainnet-acceptance-plan.json'),
    manifest:read('config/mainnet-program-release.json'),config:env,devnetEvidence:null,sourceRevision:'a'.repeat(40)};
  const packet=await buildMainnetLaunchPacket(input);
  for(const name of ['configuredFeeRecipient','configuredPayer','configuredMetadata'])assert.equal(packet.checks[name],true);
  assert.equal(packet.ready,false);assert.equal(packet.reviewedRelease,'blocked');
  for(const [field,value,check]of [
    ['FUNDED_TRADE_FEE_OWNER',plan.adminWallet,'configuredFeeRecipient'],
    ['VITE_FUNDED_TRADE_FEE_OWNER',plan.adminWallet,'configuredFeeRecipient'],
    ['MAINNET_DEPLOYMENT_PAYER_SIGNER_REFERENCE','other-payer','configuredPayer'],
    ['PINATA_JWT_FILE','other-metadata-file','configuredMetadata']]){
    const wrong=await buildMainnetLaunchPacket({...input,config:{...env,[field]:value}});
    assert.equal(wrong.checks[check],false);
  }
});
