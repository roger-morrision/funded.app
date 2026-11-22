import test from 'node:test';
import assert from 'node:assert/strict';
import {apiEntrypointFixture} from './api-entrypoint-fixture.mjs';

for(const profile of [{name:'Devnet',cluster:'devnet'},{name:'Mainnet read-only',cluster:'mainnet-beta'},
  {name:'Mainnet existing non-program',cluster:'mainnet-beta',nonProgram:true}])test('API entrypoint initializes network before runtime and serves honest '+profile.name+' status',async t=>{
  const f=await apiEntrypointFixture(t,profile),origin=await f.listening();
  const health=await f.request(origin,'/api/health');assert.equal(health.status,200);assert.equal(health.body.ok,true);
  assert.equal(health.body.launchPolicy.cluster,profile.cluster);assert.equal(health.body.external.solanaKeeper,false);
  assert.equal(health.body.external.feeRouter,false);assert.equal(health.body.external.automaticRewards,false);
  const readiness=await f.request(origin,'/api/readiness');assert.equal(readiness.status,200);assert.equal(readiness.body.cluster,profile.cluster);
  assert.equal(readiness.body.ready,false);assert.equal(readiness.body.configurationComplete,false);
  const status=await f.request(origin,'/api/status');assert.equal(status.status,200);assert.equal(status.body.cluster,profile.cluster);
  assert.equal(status.body.build,'entrypoint-offline-fixture');assert.equal(status.body.status,'degraded');
  assert.equal(status.body.checks.find(c=>c.id==='storage').status,'operational');assert.notEqual(status.body.checks.find(c=>c.id==='network').status,'operational');
  assert.equal(status.body.settlementVerified,false);assert.equal(status.body.mainnetActivationAuthorized,false);
  if(profile.cluster==='mainnet-beta'){
    const blocked=await f.request(origin,'/api/launches',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(blocked.status,403);assert.match(blocked.body.error,/financial release is verified/);
  }
  assert(f.methods.includes('getGenesisHash'));assert.equal(f.financialRpc,0);assert(!f.stderr.includes('ReferenceError'));
});

test('API entrypoint refuses mismatched server and browser networks before listening',async t=>{
  const f=await apiEntrypointFixture(t,{cluster:'devnet',clientCluster:'mainnet-beta'}),result=await f.exit;
  assert.equal(result.code,1);assert.match(f.stderr,/Server and browser Solana networks must match/);assert(!f.stdout.includes('app listening'));
  assert.deepEqual(f.methods,[]);assert.equal(f.financialRpc,0);
});

test('API entrypoint refuses an unsupported network before runtime construction',async t=>{
  const f=await apiEntrypointFixture(t,{cluster:'invalid-network'}),result=await f.exit;
  assert.equal(result.code,1);assert.match(f.stderr,/Unsupported Solana (cluster|network)/);assert(!f.stdout.includes('app listening'));
  assert.deepEqual(f.methods,[]);assert.equal(f.financialRpc,0);
});
