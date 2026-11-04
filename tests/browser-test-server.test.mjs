import test from 'node:test';
import assert from 'node:assert/strict';
import setupBrowserTests,{startBrowserTestServer} from '../scripts/browser-test-server.mjs';
import warmBrowserTests from '../scripts/browser-test-warmup.mjs';

test('managed browser server pins loopback, refuses port fallback, closes once and restores the environment',async()=>{
  const env={VITE_SOLANA_CLUSTER:'mainnet-beta',VITE_API_BASE_URL:'original'},before={...env};let listened=0,closed=0;
  const close=await startBrowserTestServer('http://127.0.0.1:4173',{env,factory:async options=>{
    assert.equal(options.server.host,'127.0.0.1');assert.equal(options.server.port,4173);assert.equal(options.server.strictPort,true);
    assert.equal(env.VITE_SOLANA_CLUSTER,'devnet');assert.equal(env.VITE_EXPLORE_CLUSTER,'devnet');
    return{listen:async()=>listened++,close:async()=>closed++};
  }});
  assert.equal(listened,1);await Promise.all([close(),close()]);assert.equal(closed,1);assert.deepEqual(env,before);
});

test('startup and occupied-port failures clean up without adopting or terminating an existing server',async()=>{
  for(const failAt of ['create','listen']){
    const env={},error=new Error('startup failed');let closed=0;
    await assert.rejects(()=>startBrowserTestServer('http://localhost:4173',{env,factory:async()=>{
      if(failAt==='create')throw error;
      return{listen:async()=>{throw error;},close:async()=>closed++};
    }}),actual=>actual===error);
    assert.deepEqual(env,{});assert.equal(closed,failAt==='listen'?1:0);
  }
});

test('shutdown errors restore the original environment and remain visible to the test runner',async()=>{
  const env={VITE_DEV_AUTOCONNECT:'original'},before={...env},error=new Error('close failed');
  const close=await startBrowserTestServer('http://localhost:4173',{env,factory:async()=>({listen:async()=>{},close:async()=>{throw error;}})});
  await assert.rejects(close,actual=>actual===error);assert.deepEqual(env,before);
});

test('managed test server rejects non-loopback and credential-bearing origins before changing configuration',async()=>{
  for(const base of ['https://funded.vip','http://0.0.0.0:4173','http://user:password@localhost:4173','http://localhost:4173/path']){
    const env={};await assert.rejects(()=>startBrowserTestServer(base,{env,factory:()=>assert.fail('Must not start')}));assert.deepEqual(env,{});
  }
});

test('warmup failure closes the owned server and successful setup returns its teardown',async()=>{
  const config={projects:[{use:{baseURL:'http://127.0.0.1:4173'}}]};let closed=0;
  const close=()=>{closed++;},start=async()=>close,error=new Error('warmup failed');
  await assert.rejects(()=>setupBrowserTests(config,{start,warm:async()=>{throw error;}}),actual=>actual===error);assert.equal(closed,1);
  const teardown=await setupBrowserTests(config,{start,warm:async()=>{}});assert.equal(closed,1);await teardown();assert.equal(closed,2);
});

test('external URLs and explicit integration web servers retain their own lifecycle',async()=>{
  let warmed=0;
  for(const config of [{projects:[{use:{baseURL:'https://funded.vip'}}]},
    {projects:[{use:{baseURL:'http://127.0.0.1:4173'}}],webServer:{command:'external integration fixture'}}]){
    await setupBrowserTests(config,{start:()=>assert.fail('Must not own external server'),warm:async()=>warmed++});
  }
  assert.equal(warmed,2);
});

test('warmup closes the browser even when context creation or context cleanup fails',async()=>{
  for(const phase of ['create','close']){
    let closed=0;const error=new Error('context failed');
    const context={route:async()=>{},newPage:async()=>({goto:async()=>{},locator:()=>({waitFor:async()=>{}})}),close:async()=>{throw error;}};
    const browserType={launch:async()=>({newContext:async()=>{if(phase==='create')throw error;return context;},close:async()=>closed++})};
    await assert.rejects(()=>warmBrowserTests({projects:[{use:{baseURL:'http://127.0.0.1:4173'}}]},{browserType}),actual=>actual===error);
    assert.equal(closed,1);
  }
});
