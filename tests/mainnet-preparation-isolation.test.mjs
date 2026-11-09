import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {loadMainnetConfig} from '../scripts/mainnet-config.mjs';
import {mainnetStagingProblems} from '../server/mainnet-staging-policy.mjs';
import {loadServerEnvironment} from '../server/environment.mjs';
import {createFeeRouterService} from '../server/fee-router-service.mjs';
import {createV3LaunchConfig} from '../server/v3-launch-config.mjs';
import {startApiFinancialWorkerServices} from '../server/api-financial-workers.mjs';
import {startCommunityClaimIndex} from '../server/background-maintenance.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';

test('Mainnet explicit loader rejects activation and signing credentials before reading referenced files',()=>{
  for(const setting of ['FUNDED_V3_BUYBACK_ENABLED=yes','VITE_ALLOW_MAINNET=1','DEVNET_TEST_MODE=true',
    'FUNDED_V3_ROUTER_AUTHORITY_KEYPAIR_PATH=/secret','PRICE_SIGNER_KEY_FILE=/secret',
    'FUNDED_ADMIN_OPERATIONS_SIGNER_FILE=/secret','NODE_OPTIONS=--require=hook',
    'node_options=--require=hook','funded_v3_buyback_enabled=true']) {
    let reads=0;
    assert.throws(()=>loadMainnetConfig('/fixture/mainnet.env',{read:()=>{
      reads++;return `SOLANA_CLUSTER=mainnet-beta\nVITE_SOLANA_CLUSTER=mainnet-beta\nSOLANA_RPC_URL_FILE=rpc\n${setting}`;
    }}),/Read-only staging/);
    assert.equal(reads,1);
  }
  assert.deepEqual(mainnetStagingProblems({VITE_ALLOW_MAINNET:'false',FUNDED_V3_BUYBACK_ENABLED:'false',
    MAINNET_DEPLOYMENT_PAYER_SIGNER_REFERENCE:'PLACEHOLDER',PRICE_SIGNER_KEY_FILE:''}),[]);
});

test('Mainnet startup never imports local environment or implicitly expands secrets',()=>{
  for(const env of [{SOLANA_CLUSTER:'mainnet-beta'},{VITE_SOLANA_CLUSTER:'mainnet-beta'},
    {SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'mainnet-beta'}]) {
    let reads=0;
    assert.throws(()=>loadServerEnvironment({env,readFile:()=>{reads++;return 'private';}}),/explicit isolated/);
    assert.equal(reads,0);
    loadServerEnvironment({env:{...env,FUNDED_SKIP_LOCAL_ENV:'true'},readFile:()=>{reads++;}});
    assert.equal(reads,0);
  }
});

test('staging internal API credential can be loaded explicitly without exposing it in errors',()=>{
  const contents='SOLANA_CLUSTER=mainnet-beta\nVITE_SOLANA_CLUSTER=mainnet-beta\nFUNDED_API_TOKEN_FILE=api-token';
  const result=loadMainnetConfig('/fixture/mainnet.env',{read:path=>path.endsWith('mainnet.env')?contents:'isolated-api-token'});
  assert.equal(result.FUNDED_API_TOKEN,'isolated-api-token');
  assert.throws(()=>loadMainnetConfig('/fixture/mainnet.env',{read:path=>path.endsWith('mainnet.env')?contents:(()=>{throw Error('secret-value');})()}),
    error=>error.message.includes('FUNDED_API_TOKEN_FILE')&&!error.message.includes('secret-value'));
});

test('Mainnet service accessors, launch readiness and worker startup do not touch transaction keys',async()=>{
  const service=createFeeRouterService({solanaCluster:'mainnet-beta',env:{
    SOLANA_KEEPER_KEYPAIR_PATH:'/must-not-read',SOLANA_REFERRAL_PAYOUT_KEYPAIR_PATH:'/must-not-read',
    FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'/must-not-read',FUNDED_V3_ROUTER_AUTHORITY_KEYPAIR_PATH:'/must-not-read'}});
  for(const name of ['keeperKeypair','referralPayoutKeypair','routerAuthorityKeypair','v3AuthorityKeypair'])assert.equal(service[name](),null);
  await assert.rejects(service.collectPumpCreatorFees({}),/Keeper configuration/);
  await assert.rejects(service.executeSolPayout({recipientWallet:'unused',amountSol:1}),/not configured/);
  let touches=0;const context={solanaCluster:'mainnet-beta',v3AuthorityKeypair:()=>{touches++;},
    env:{FUNDED_API_ONLY:'false',FUNDED_V3_HOLDER_WORKER_ENABLED:'true',FUNDED_V3_BUYBACK_ENABLED:'true'}};
  assert.deepEqual(startApiFinancialWorkerServices(context),{mode:'mainnet-read-only',started:[]});
  startCommunityClaimIndex(context);
  const read=createV3LaunchConfig({...context,automaticRewardStore:{read:async()=>({})}});
  const result=await read();assert.equal(result.ready,false);assert.equal(result.initialAuthority,null);assert.equal(touches,0);
});

test('fee collection and referral transfers stop on a wrong RPC before reading state or broadcasting',async()=>{
  const keeper=Keypair.generate(),payer=Keypair.generate();let stateReads=0,sends=0;
  const service=createFeeRouterService({solanaCluster:'devnet',solanaRpcUrl:'https://fixture.invalid',devnetTestMode:true,
    env:{SOLANA_KEEPER_SECRET_KEY:bs58.encode(keeper.secretKey),SOLANA_REFERRAL_PAYOUT_SECRET_KEY:bs58.encode(payer.secretKey)},
    store:{readLaunch:async()=>{stateReads++;}},Connection:class{async getGenesisHash(){return SOLANA_GENESIS['mainnet-beta'];}},
    sendAndConfirmTransaction:async()=>{sends++;},sendFinalizedSolPayout:async()=>{sends++;},reconcileFinalizedSolPayout:async()=>{sends++;}});
  await assert.rejects(service.collectPumpCreatorFees({requestedMint:String(keeper.publicKey)}),/network/);
  await assert.rejects(service.executeSolPayout({recipientWallet:String(keeper.publicKey),amountSol:1}),/network/);
  await assert.rejects(service.reconcileSolPayout({recipientWallet:String(keeper.publicKey),amountSol:1,from:String(payer.publicKey),signature:'old'}),/network/);
  assert.equal(stateReads,0);assert.equal(sends,0);
});
