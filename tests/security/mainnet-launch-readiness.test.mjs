import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {createV3LaunchConfig} from '../../server/v3-launch-config.mjs';
import {createLaunchRegistrationRoutes} from '../../server/routes/launch-registration.mjs';
import {mainnetLaunchFixture} from './mainnet-launch-fixture.mjs';

test('Mainnet launch reader verifies a finalized public snapshot without granting execution',async()=>{
  const f=mainnetLaunchFixture(),result=await f.reader()();
  assert.equal(result.preparation.status,'verified');assert.equal(result.ready,false);
  assert.equal(result.preparation.signingEnabled,false);assert.equal(result.initialAuthority,String(f.operator));
  assert.equal(result.preparation.proof.slot,200);assert.doesNotThrow(()=>JSON.stringify(result));
  const snapshot=f.calls.find(row=>row[0]==='snapshot');
  assert.deepEqual(snapshot[1],f.addresses);assert.deepEqual(snapshot[2],{commitment:'finalized',minContextSlot:190});
  assert.deepEqual(f.calls.find(row=>row[0]==='revision')[2],{commitment:'finalized',minContextSlot:200});
});

test('Mainnet launch reader rejects missing review and mismatched public roles before RPC',async()=>{
  for(const change of [f=>{f.release.status='awaiting-review';},f=>{f.env.FUNDED_TOKEN_MINT=String(f.owner);},
    f=>{f.env.FUNDED_V3_PROGRAM_DATA_SHA256='f'.repeat(64);},f=>{f.env.FUNDED_V3_GUARDIAN_PUBLIC_KEY=String(f.operator);},
    f=>{f.env.FUNDED_FEE_ROUTER_PROGRAM_ID=String(f.owner);},
    f=>{f.env.FUNDED_V3_PRICE_ATTESTOR_PUBLIC_KEY=String(PublicKey.default);},
    f=>{delete f.env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE;}]){
    const f=mainnetLaunchFixture();change(f);const result=await f.reader()();
    assert.equal(result.preparation.status,'blocked');assert.equal(result.ready,false);assert.equal(f.factories,0);
  }
});

test('Mainnet launch reader rejects stale context, wrong chain and altered program or custody accounts',async()=>{
  for(const change of [f=>{f.genesis=SOLANA_GENESIS.devnet;},f=>{f.slot=189;},f=>{f.revisionSlot=199;},
    f=>{f.accounts[1].data[45]^=1;},f=>{f.accounts[0].executable=false;},
    f=>{f.accounts[2].data[106]=1;},f=>{f.accounts[2].data[74]^=1;},f=>{f.accounts[2].data[41]^=1;},
    f=>{f.accounts[2].executable=true;},f=>{f.accounts[3].data[8]^=1;},
    f=>{f.accounts[4].data[8]^=1;},f=>{f.revision.data[40]^=1;},
    f=>{f.accounts[6].owner=f.program;},f=>{f.accounts[6].data.writeBigUInt64LE(1n,4);},
    f=>{f.accounts[6].data.writeBigUInt64LE(200n,12);},f=>{f.accounts[7]=null;},
    f=>{f.accounts[1].data.writeBigUInt64LE(200n,4);
      const hash=createHash('sha256').update(f.accounts[1].data).digest('hex');
      f.release.programDataSha256=hash;f.env.FUNDED_V3_PROGRAM_DATA_SHA256=hash;f.env.FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256=hash;}]){
    const f=mainnetLaunchFixture();change(f);const result=await f.reader()();
    assert.equal(result.ready,false);assert.equal(result.preparation.status,'unavailable');
    assert.equal(result.beneficiaryRoutingOnChainEnforced,false);
  }
});

test('Mainnet launch routes expose public readiness but refuse registration and reserve activation',async()=>{
  const f=mainnetLaunchFixture(),responses=[];let bodyCalls=0,signerCalls=0;
  const handle=createLaunchRegistrationRoutes({solanaCluster:'mainnet-beta',env:f.env,store:f.store,
    v3LaunchConfig:f.reader(),v3AuthorityKeypair:()=>{signerCalls++;throw Error('No custody');},
    body:()=>{bodyCalls++;throw Error('No write body');},respond:(_res,status,value)=>responses.push({status,value})});
  for(const [method,path]of [['GET','/api/v3-launch-config'],['GET','/api/launch-reserve-config'],['POST','/api/launches']])
    assert.equal(await handle({method},{},new URL('https://app.invalid'+path)),true);
  assert.equal(responses[0].status,200);assert.equal(responses[0].value.preparation.status,'verified');
  assert.equal(responses[0].value.ready,false);assert.equal(responses[1].status,503);assert.equal(responses[2].status,403);
  assert.equal(bodyCalls,0);assert.equal(signerCalls,0);
});

test('Mainnet launch reader rejects unpublished, stale and mismatched agency policy',async()=>{
  for(const change of [f=>{f.policy=null;},f=>{f.policy.configRevision='2';},
    f=>{f.policy.split.operationsPercent++;},f=>{f.policy.rules.promotionIntervalSeconds++;},
    f=>{f.accounts[5].data=f.accounts[5].data.subarray(0,77);}]){
    const f=mainnetLaunchFixture();change(f);const result=await f.reader()();
    assert.equal(result.ready,false);assert.equal(result.preparation.status,'unavailable');
  }
});

test('Mainnet launch reads coalesce, expire on timeout and recheck after role rotation',async()=>{
  const f=mainnetLaunchFixture(),read=f.reader();
  const [first,second]=await Promise.all([read(),read()]);
  assert.equal(first.preparation.status,'verified');assert.equal(second,first);assert.equal(f.factories,1);
  f.accounts[2].data[41]^=1;
  assert.equal((await read()).preparation.status,'unavailable');assert.equal(f.factories,2);
  const hung=mainnetLaunchFixture();let signal;
  const result=await hung.reader({verificationTimeoutMs:10,connectionFactory:(_url,options)=>{
    signal=options.signal;return {getGenesisHash:()=>new Promise(()=>{})};}})();
  assert.equal(result.preparation.status,'unavailable');assert.equal(signal.aborted,true);
  const slowStore=mainnetLaunchFixture();
  const delayed=await slowStore.reader({verificationTimeoutMs:10,store:{read:()=>new Promise(()=>{})}})();
  assert.equal(delayed.preparation.status,'unavailable');assert.equal(slowStore.factories,0);
});

test('Mainnet capability integration never loads a signer or admits launches through flags',async()=>{
  const f=mainnetLaunchFixture();let signerCalls=0,rpcCalls=0;
  const read=createV3LaunchConfig({solanaCluster:'mainnet-beta',solanaRpcUrl:'https://mainnet.invalid',store:f.store,
    env:{...f.env,FUNDED_V3_LAUNCH_ENABLED:'true',VITE_ALLOW_MAINNET:'true'},
    v3AuthorityKeypair:()=>{signerCalls++;throw Error('Must not load private custody');},
    connectionFactory:()=>{rpcCalls++;throw Error('Unreviewed deployment must not read RPC');}});
  const result=await read();assert.equal(result.ready,false);assert.equal(result.preparation.status,'blocked');
  assert.deepEqual(result.protocolSplit,f.policy.split);
  assert.equal(signerCalls,0);assert.equal(rpcCalls,0);
  const devnet=await createV3LaunchConfig({solanaCluster:'devnet',env:{},store:f.store,
    v3AuthorityKeypair:()=>{signerCalls++;return null;}})();
  assert.equal(devnet.cluster,'devnet');assert.equal(devnet.preparation,undefined);assert.equal(signerCalls,1);
});
