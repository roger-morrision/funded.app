import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {metadataStatement,devnetLaunchMetadataUri} from '../devnet-metadata.js';
import {publicMetadata} from '../server/devnet-metadata.mjs';
import {createDevnetMetadataRoutes} from '../server/routes/devnet-metadata.mjs';
import {assertMetadataPublication} from '../metadata-publication.js';
import {assertSymbolAvailable,reserveLaunchSymbol,registerLaunchProtection,LAUNCH_PROTECTION_MS} from '../server/launch-protections.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';

function fixture({cluster='devnet',genesis=SOLANA_GENESIS.devnet,existing=null}={}){
  const signer=Keypair.generate(),record={mint:Keypair.generate().publicKey.toBase58(),
    creatorWallet:signer.publicKey.toBase58(),name:'Devnet fixture',symbol:'FIXTURE',imageSha256:''};
  const state={launches:{},launchSymbolReservations:{}},effects={updates:0,published:0,accountReads:0,networkReads:0,saved:0};
  let response;
  const store={read:async()=>structuredClone(state),update:async action=>{effects.updates++;return action(state);},
    readMetadata:async()=>existing?{...record,...existing}:null,
    writeMetadata:async prepared=>{effects.saved++;return prepared;}};
  const route=createDevnetMetadataRoutes({store,solanaCluster:cluster,solanaRpcUrl:'https://rpc.invalid',
    devnetMetadataOrigin:'https://metadata.example',
    body:async()=>({...record,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(record)),signer.secretKey))}),
    respond:(_res,status,data)=>{response={status,data};},
    connectionFactory:()=>({getGenesisHash:async()=>{effects.networkReads++;return genesis;},
      getAccountInfo:async()=>{effects.accountReads++;return null;}}),
    publish:async({record:prepared})=>{effects.published++;return prepared;},
    verifyPublication:async saved=>({verified:true,uri:devnetLaunchMetadataUri(saved.mint),image:publicMetadata(saved).image,
      storage:'hosted-devnet',checkedAt:new Date().toISOString()})});
  return {record,state,store,effects,run:async()=>{await route({method:'POST'},{},new URL('https://app.example/api/devnet-metadata'));return response;}};
}

test('conflicting immutable metadata cannot reserve a different ticker',async()=>{
  const f=fixture({existing:{symbol:'ORIGINAL'}}),r=await f.run();
  assert.equal(r.status,409);assert.deepEqual(f.state.launchSymbolReservations,{});
  assert.deepEqual(f.effects,{updates:0,published:0,accountReads:0,networkReads:0,saved:0});
});

test('wrong RPC network stops metadata before any reservation, upload or account read',async()=>{
  const f=fixture({genesis:SOLANA_GENESIS['mainnet-beta']}),r=await f.run();
  assert.equal(r.status,503);assert.match(r.data.error,/network could not be verified/);
  assert.deepEqual(f.effects,{updates:0,published:0,accountReads:0,networkReads:1,saved:0});
});

test('Devnet metadata verifies genesis and returns a network-bound publication proof',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.status,201);
  assert.equal(r.data.cluster,'devnet');assert.equal(r.data.genesisHash,SOLANA_GENESIS.devnet);
  assert.equal(f.state.launchSymbolReservations.FIXTURE.mint,f.record.mint);
  assert.deepEqual(f.effects,{updates:1,published:1,accountReads:1,networkReads:1,saved:1});
  assertMetadataPublication(r.data,r.data.uri);
});

test('Mainnet metadata writes remain blocked without reading bodies, RPC or storage',async()=>{
  const f=fixture({cluster:'mainnet-beta'}),r=await f.run();assert.equal(r.status,403);
  assert.deepEqual(f.effects,{updates:0,published:0,accountReads:0,networkReads:0,saved:0});
});

test('browser refuses a wrong-network metadata proof while preserving legacy Devnet responses',async()=>{
  const r=await fixture().run(),d=r.data;
  for(const change of [{cluster:'mainnet-beta'},{genesisHash:SOLANA_GENESIS['mainnet-beta']}])
    assert.throws(()=>assertMetadataPublication({...d,...change},d.uri),/selected network/);
  const {cluster,genesisHash,...legacy}=d;assertMetadataPublication(legacy,d.uri);
  assert.throws(()=>assertMetadataPublication(legacy,d.uri,Date.now(),'mainnet-beta'),/selected network/);
});

test('legacy Devnet launches without a cluster retain their ticker protection',()=>{
  const now=Date.now(),state={launches:{old:{mint:'old',symbol:'FIXTURE',onchainVerified:true,blockTime:Math.floor(now/1000)-60}}};
  assert.throws(()=>assertSymbolAvailable(state,{mint:'new',symbol:'FIXTURE'},now),/protected until/);
  assert.equal(assertSymbolAvailable(state,{mint:'new',symbol:'FIXTURE'},now+LAUNCH_PROTECTION_MS),'FIXTURE');
  assert.equal(assertSymbolAvailable(state,{mint:'new',symbol:'FIXTURE',cluster:'mainnet-beta'},now),'mainnet-beta:FIXTURE');
});

test('network-scoped leases preserve old Devnet keys and cannot overwrite each other',async()=>{
  const f=fixture(),now=Date.now();
  await reserveLaunchSymbol({store:f.store,record:f.record,mintExists:async()=>false,now});
  const mainnet={...f.record,mint:'other',cluster:'mainnet-beta'};
  await reserveLaunchSymbol({store:f.store,record:mainnet,mintExists:async()=>false,now});
  assert.equal(f.state.launchSymbolReservations.FIXTURE.mint,f.record.mint);
  assert.equal(f.state.launchSymbolReservations['mainnet-beta:FIXTURE'].mint,'other');
  assert.throws(()=>assertSymbolAvailable(f.state,{...f.record,mint:'third'},now),/reserved until/);
  registerLaunchProtection(f.state,{...f.record,blockTime:Math.floor(now/1000),launchProtection:{symbolBlockedUntil:new Date(now+LAUNCH_PROTECTION_MS).toISOString()}},now);
  assert.equal(f.state.launchSymbolReservations.FIXTURE.registered,true);
  assert.equal(f.state.launchSymbolReservations['mainnet-beta:FIXTURE'].registered,undefined);
});

test('expired leases survive RPC failure and changed reservations reject stale updates',async()=>{
  const f=fixture(),now=Date.now(),old={mint:'old',creatorWallet:'owner',expiresAt:now-1,holdUntil:now-1};
  f.state.launchSymbolReservations.FIXTURE=old;
  await assert.rejects(()=>reserveLaunchSymbol({store:f.store,record:f.record,now,mintExists:async mint=>{
    if(mint==='old')throw Error('RPC unavailable');return false;
  }}),/RPC unavailable/);
  assert.deepEqual(f.state.launchSymbolReservations.FIXTURE,old);
  await assert.rejects(()=>reserveLaunchSymbol({store:f.store,record:f.record,now,mintExists:async()=>{
    f.state.launchSymbolReservations.FIXTURE={...old,mint:'racer'};return false;
  }}),/reservation changed/);
  assert.equal(f.state.launchSymbolReservations.FIXTURE.mint,'racer');
});
