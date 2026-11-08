import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {verifyV3LaunchRouterReadiness} from '../server/v3-launch-readiness.mjs';
import {deriveMintRouterV3} from '../mint-router-v3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {createMetadataPublisher,verifyPublishedMetadata} from '../server/metadata-publication.mjs';
import {deploymentCluster,mainnetMutationBlocked} from '../server/network-write-policy.mjs';
import {createSolanaRpcProxy} from '../server/rpc-proxy.mjs';

const key=n=>new PublicKey(new Uint8Array(32).fill(n)).toBase58();
function fixture(cluster='mainnet-beta'){
  const effects={program:0,global:0,router:0,policy:0},programId=key(1),mint=key(2);
  const options={cluster,programId,mint,creatorWallet:key(3),initialAuthority:key(4),expectedProgramDataSha256:'ab'.repeat(32),
    connection:{getGenesisHash:async()=>SOLANA_GENESIS[cluster]},
    readEvidence:async(_connection,_program,config)=>{effects.program++;if(cluster==='mainnet-beta')assert.equal(config.rpcUrl,'');
      return {account:{executable:true},sha256:'ab'.repeat(32)};},
    verifyGlobal:async()=>{effects.global++;return {verified:true};},
    verifyRouter:async()=>{effects.router++;return {verified:true,address:deriveMintRouterV3(programId,mint).address};},
    verifyPolicy:async()=>{effects.policy++;return {verified:true};}};
  return {options,effects};
}
test('router proof binds the selected network and uses the explicit Mainnet connection',async()=>{
  for(const cluster of ['devnet','mainnet-beta']){
    const f=fixture(cluster),proof=await verifyV3LaunchRouterReadiness(f.options);
    assert.equal(proof.ready,true);assert.equal(proof.cluster,cluster);assert.equal(proof.genesisHash,SOLANA_GENESIS[cluster]);
    assert.deepEqual(f.effects,{program:1,global:1,router:1,policy:1});
  }
});
test('wrong or unknown network cannot read or approve program and mint accounts',async()=>{
  for(const cluster of ['mainnet-beta','testnet']){
    const f=fixture(cluster);f.options.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
    assert.equal((await verifyV3LaunchRouterReadiness(f.options)).ready,false);
    assert.deepEqual(f.effects,{program:0,global:0,router:0,policy:0});
  }
});
test('a matching chain cannot approve mismatched program bytes',async()=>{
  const f=fixture();f.options.expectedProgramDataSha256='cd'.repeat(32);
  assert.equal((await verifyV3LaunchRouterReadiness(f.options)).ready,false);
  assert.equal(f.effects.router,0);assert.equal(f.effects.policy,0);
});
test('Mainnet metadata never falls back to mutable Devnet hosting',async()=>{
  let fetched=0;const fetchImpl=async()=>{fetched++;throw Error('unexpected request');};
  const record={cluster:'mainnet-beta',mint:key(1),name:'Fixture',symbol:'FIX'};
  await assert.rejects(()=>createMetadataPublisher({env:{},fetchImpl})({record}),/durable content-addressed/);
  await assert.rejects(()=>verifyPublishedMetadata(record,{fetchImpl}),/durable content-addressed/);
  assert.equal(fetched,0);
});

test('Mainnet backend refuses mutations even with trading flags enabled; Devnet stays available',()=>{
  const cluster=deploymentCluster({SOLANA_CLUSTER:'mainnet-beta',VITE_SOLANA_CLUSTER:'mainnet-beta',VITE_ALLOW_MAINNET:'true'});
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/api/launches','/api/token-metadata','/api/admin/settings','/api/mobile-wallet/relay']){
    assert.equal(mainnetMutationBlocked(cluster,method,path),true);
    assert.equal(mainnetMutationBlocked('devnet',method,path),false);
  }
  assert.equal(mainnetMutationBlocked(cluster,'GET','/api/status'),false);
  assert.equal(mainnetMutationBlocked(cluster,'POST','/api/solana/rpc'),false);
  assert.throws(()=>deploymentCluster({SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'mainnet-beta'}),/must match/);
  assert.throws(()=>deploymentCluster({SOLANA_CLUSTER:'testnet'}),/Unsupported/);
});

test('Mainnet signed transaction forwarding is blocked before rate storage or upstream access',async()=>{
  for(const method of ['sendTransaction','requestAirdrop']){
    let effects=0,response;
    const {proxySolanaRpc}=createSolanaRpcProxy({solanaCluster:'mainnet-beta',solanaRpcUrl:'https://unused.invalid',
      body:async()=>({jsonrpc:'2.0',id:9,method,params:['signed-wire']}),rpcMethods:new Set([method]),
      store:{chargeRpcRate:async()=>{effects++;return true;}},authorized:()=>true,clientKey:()=>'',
      fetch:async()=>{effects++;throw Error('unexpected upstream');},json:(_res,status,data)=>{response={status,data};}});
    await proxySolanaRpc({headers:{},url:'/api/solana/rpc'},{});
    assert.equal(response.status,403);assert.equal(response.data.id,9);assert.equal(effects,0);
  }
});
