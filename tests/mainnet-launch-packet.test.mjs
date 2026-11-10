import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import {buildMainnetLaunchPacket} from '../scripts/mainnet-launch-packet.mjs';
import {mainnetStagingEnvironment} from '../scripts/start-mainnet-staging.mjs';
import {loadMainnetConfig} from '../scripts/mainnet-config.mjs';
import {v3XClaimStatement} from '../server/routes/v3-x-claims.mjs';
import {communityProgramForLaunch} from '../server/community-program-config.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
import {browserReleaseIdentity} from '../browser-release-identity.js';
import viteConfig,{browserBuildSettings} from '../vite.config.js';

const read=name=>JSON.parse(readFileSync(`config/${name}.json`,'utf8'));
const key=n=>new PublicKey(new Uint8Array(32).fill(n)).toBase58();
function packet(){return {plan:read('mainnet-deployment-plan'),acceptance:read('mainnet-acceptance-plan'),
  manifest:read('mainnet-program-release'),config:loadMainnetConfig('config/mainnet-staging.example'),sourceRevision:'a'.repeat(40)};}
function config(){return {MAINNET_PROGRAM_LAYOUT:'merged-v3',VITE_SOLANA_CLUSTER:'mainnet-beta',SOLANA_CLUSTER:'mainnet-beta',
  FUNDED_API_TOKEN:'isolated-test-only-api-token',
  VITE_MAINNET_READ_ONLY:'true',VITE_ALLOW_MAINNET:'false',MAINNET_APP_ORIGIN:'https://mainnet.example',
  FUNDED_TRADE_FEE_OWNER:key(2),VITE_FUNDED_TRADE_FEE_OWNER:key(2),
  FUNDED_V3_FEE_ROUTER_PROGRAM_ID:key(1),FUNDED_V3_PROGRAM_DATA_SHA256:'ab'.repeat(32),
  FUNDED_DEVELOPER_LOCK_PROGRAM_ID:key(1),FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:'ab'.repeat(32),
  VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:key(1),MAINNET_APPROVED_UPGRADE_AUTHORITY:key(2),
  FUNDED_TOKEN_MINT:key(3),VITE_FUNDED_TOKEN_MINT:key(3),FUNDED_SWAP_POOL:key(4),VITE_FUNDED_SWAP_POOL:key(4),
  METADATA_STORAGE:'pinata',PINATA_JWT_FILE:'/run/secrets/metadata',
  SOLANA_RPC_URL:'https://rpc.mainnet.example',DEVNET_SOLANA_RPC_URL:'https://rpc.devnet.example',
  DATABASE_URL:'postgresql://db/mainnet',DEVNET_DATABASE_URL:'postgresql://devnet/db'};}
const build={schemaVersion:1,cluster:'mainnet-beta',exploreCluster:'mainnet-beta',mainnetEnabled:false,mainnetReadOnly:true,devWalletEnabled:false,
  publicIdentity:browserReleaseIdentity(config())};

test('placeholder packet lists missing production inputs without granting activation or treating history as current',async()=>{
  const input=packet();input.devnetEvidence={schemaVersion:1,cluster:'devnet',application:{revision:'b'.repeat(40)},
    acceptance:input.acceptance.requiredCases.map(row=>({id:row.id,status:'passed-live'}))};
  input.config.DATABASE_URL='postgresql://secret-user:secret-password@db/mainnet';
  input.plan.maximumTotalSpendLamports=null;
  input.plan.maximumTotalSpendLamports=null;
  const result=await buildMainnetLaunchPacket(input);
  assert.equal(result.ready,false);assert.equal(result.mainnetActivationAuthorized,false);
  assert.equal(result.checks.reviewedExactRelease,false);assert.equal(result.checks.boundedSpend,false);
  assert(result.missingProductionInputs.includes('freshSignerReferences.priceAttestation'));
  assert.equal(result.devnetEvidence.cases.length,14);
  assert(result.devnetEvidence.cases.some(row=>row.id==='daily-bonus'));
  assert(result.devnetEvidence.cases.every(row=>row.currentReleaseVerified===false));
  assert(!JSON.stringify(result).includes('secret-password'));
});
test('packet refuses enabled activation, incomplete plans, duplicate evidence and invented source identities',async()=>{
  const a=packet();a.plan.mainnetActivationAuthorized=true;await assert.rejects(buildMainnetLaunchPacket(a),/disabled/);
  const b=packet();b.sourceRevision='main';await assert.rejects(buildMainnetLaunchPacket(b),/exact source/);
  const c=packet();c.acceptance.requiredCases.pop();assert.equal((await buildMainnetLaunchPacket(c)).checks.completeAcceptancePlan,false);
  const d=packet();d.devnetEvidence={schemaVersion:1,cluster:'devnet',application:{revision:'b'.repeat(40)},
    acceptance:[{id:'launch-standard',status:'passed-live'},{id:'launch-standard',status:'passed-live'}]};
  assert.equal((await buildMainnetLaunchPacket(d)).devnetEvidence.cases.find(row=>row.id==='launch-standard').recordedStatus,'unavailable');
});

test('selected public admin, authority and spending cap must agree across the launch inputs',async()=>{
  const input=packet(),wallet=key(9);
  Object.assign(input.plan,{adminWallet:wallet,upgradeAuthority:wallet,maximumTotalSpendLamports:'5000000000',maximumPriorityFeeLamports:'0'});
  Object.assign(input.acceptance,{adminWallet:wallet,upgradeAuthority:wallet,maximumTotalSpendLamports:'5000000000',maximumPriorityFeeLamports:'0'});
  Object.assign(input.config,{FUNDED_ADMIN_WALLETS:wallet,MAINNET_APPROVED_UPGRADE_AUTHORITY:wallet});
  const valid=await buildMainnetLaunchPacket(input);
  assert.equal(valid.checks.adminIdentity,true);assert.equal(valid.checks.selectedAuthority,true);assert.equal(valid.checks.boundedSpend,true);
  assert.equal(valid.ready,false);
  input.acceptance.maximumTotalSpendLamports='6000000000';input.config.FUNDED_ADMIN_WALLETS=key(8);
  const invalid=await buildMainnetLaunchPacket(input);assert.equal(invalid.checks.adminIdentity,false);assert.equal(invalid.checks.boundedSpend,false);
});

test('explicit Mainnet configuration loads optional data credentials without inheriting local secrets',()=>{
  const contents='SOLANA_CLUSTER=mainnet-beta\nVITE_SOLANA_CLUSTER=mainnet-beta\nBIRDEYE_API_KEY_FILE=birdeye.key\nPINATA_JWT_FILE=metadata.key\n';
  const result=loadMainnetConfig('/config/staging.env',{read:file=>file.endsWith('staging.env')?contents:file.endsWith('birdeye.key')?'test-data-key':'test-metadata-key'});
  assert.equal(result.BIRDEYE_API_KEY,'test-data-key');assert.equal(result.PINATA_JWT,'test-metadata-key');assert.equal(result.SOLANA_KEEPER_SECRET_KEY,undefined);
  assert.throws(()=>loadMainnetConfig('/config/staging.env',{read:file=>file.endsWith('staging.env')?contents:(()=>{throw Error('sensitive upstream message');})()}),/Cannot read BIRDEYE_API_KEY_FILE/);
});
test('staging isolates inherited credentials, disables workers and rejects a wrong or writable build',()=>{
  const result=mainnetStagingEnvironment(config(),build,{systemEnv:{PATH:'tools',SOLANA_KEEPER_SECRET_KEY:'private',NODE_OPTIONS:'--require injection',DATABASE_URL:'postgresql://devnet'}});
  assert.equal(result.SOLANA_KEEPER_SECRET_KEY,undefined);assert.equal(result.NODE_OPTIONS,undefined);
  assert.equal(result.FUNDED_API_ONLY,'true');assert.equal(result.FUNDED_SKIP_LOCAL_ENV,'true');assert.equal(result.HOST,'127.0.0.1');
  assert.equal(result.DATABASE_URL,config().DATABASE_URL);
  for(const changes of [{cluster:'devnet'},{mainnetEnabled:true},{mainnetReadOnly:false},{devWalletEnabled:true}])
    assert.throws(()=>mainnetStagingEnvironment(config(),{...build,...changes}),/read-only browser/);
  for(const changes of [{FUNDED_V3_BUYBACK_ENABLED:'true'},{FUNDED_ADMIN_OPERATIONS_SIGNER_FILE:'/secret/key'}])
    assert.throws(()=>mainnetStagingEnvironment({...config(),...changes},build),/Read-only staging/);
  assert.throws(()=>mainnetStagingEnvironment(packet().config,build),/Complete/);
});
test('staging rejects a foreign asset or fee recipient even when the browser network matches',()=>{
  for(const field of ['routerProgram','fundedMint','fundedPool','tradeFeeRecipient','tradeFeeBps','apiBase']) {
    const changed={...build,publicIdentity:{...build.publicIdentity,[field]:'different'}};
    assert.throws(()=>mainnetStagingEnvironment(config(),changed),/browser identity/);
  }
  assert.throws(()=>mainnetStagingEnvironment(config(),{...build,publicIdentity:undefined}),/browser identity/);
  const publicValues=browserReleaseIdentity({...config(),BIRDEYE_API_KEY:'private-key',DATABASE_URL:'private-db',
    SOLANA_RPC_URL:'https://rpc.example/private-key',VITE_UNEXPECTED_SECRET:'private-key'});
  assert(!JSON.stringify(publicValues).includes('private'));
});

test('Mainnet preview disables local env files and release identity excludes server credentials',()=>{
  assert.equal(viteConfig({mode:'mainnet-preview'}).envDir,false);
  const settings=browserBuildSettings({}, {VITE_SOLANA_CLUSTER:'mainnet-beta',VITE_MAINNET_READ_ONLY:'true',
    DATABASE_URL:'private-db',SOLANA_RPC_URL:'https://rpc.example/private-key'});
  assert.equal(settings.publicIdentity.fundedMint,'');
  assert.equal(settings.publicIdentity.routerProgram,'');
  assert(!JSON.stringify(settings).includes('private'));
});

test('new X wallet challenges cannot be replayed across networks; historical Devnet wording is retained',()=>{
  const claim={collectionSignature:'source',mint:key(1),xUserId:'123',nonce:'abc'};
  const dev=v3XClaimStatement({...claim,cluster:'devnet'},key(2));
  const main=v3XClaimStatement({...claim,cluster:'mainnet-beta'},key(2));
  assert.notEqual(dev,main);assert(main.includes(SOLANA_GENESIS['mainnet-beta']));
  assert.equal(v3XClaimStatement(claim,key(2)),`funded.app V3 SOL reward source mint ${key(1)} X user 123 wallet ${key(2)} nonce abc`);
  assert.throws(()=>v3XClaimStatement({...claim,cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS.devnet},key(2)),/network/);
});
test('community configuration cannot reuse a Devnet launch or approve an unreviewed Mainnet program',()=>{
  const values=config(),launch={onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId:key(1),initialAuthority:key(2)}};
  assert.throws(()=>communityProgramForLaunch(launch,values,()=>({publicKey:new PublicKey(key(2))})),/Verified V3/);
  launch.cluster='mainnet-beta';assert.throws(()=>communityProgramForLaunch(launch,values,()=>({publicKey:new PublicKey(key(2))})),/Verified V3/);
});
