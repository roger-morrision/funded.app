import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`,directory=await mkdtemp(join(tmpdir(),'funded-oauth-http-')),statePath=join(directory,'state.json');
const env={...process.env,NODE_ENV:'test',FUNDED_AUTH_HTTP_FIXTURE:'1',FUNDED_STORE_PATH:statePath,HOST:'127.0.0.1',PORT:String(port),
  X_CLIENT_ID:'synthetic-client',X_CLIENT_SECRET:'synthetic-secret',X_CALLBACK_URL:`${base}/api/x/oauth/callback`,CORS_ORIGIN:base,
  DEV_MODE:'false',SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'devnet',SOLANA_RPC_URL:'http://127.0.0.1:9'};
for(const key of ['SOLANA_KEEPER_KEYPAIR_PATH','SOLANA_KEEPER_SECRET_KEY','FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH','FUNDED_ROUTER_AUTHORITY_SECRET_KEY','FUNDED_API_TOKEN','FUNDED_FEE_ROUTER_PROGRAM_ID','VITE_FUNDED_FEE_ROUTER_PROGRAM_ID','X_BEARER_TOKEN'])env[key]='';
env.FUNDED_API_TOKEN='synthetic-ops-token';
let child;
async function start(){
  child=spawn(process.execPath,['scripts/fixtures/x-oauth-api.mjs'],{env,stdio:'ignore'});
  for(let n=0;n<60;n++){try{if((await fetch(`${base}/api/x/me`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('Isolated auth API did not start.');
}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
const get=(path,cookie='')=>fetch(base+path,{headers:{cookie},redirect:'manual',signal:AbortSignal.timeout(5000)});
try {
  await start();
  assert.equal((await get('/api/ops/receipt-worker')).status,401);
  const ops=await fetch(`${base}/api/ops/receipt-worker`,{headers:{authorization:'Bearer synthetic-ops-token'}});assert.equal(ops.status,200);assert.equal(ops.headers.get('cache-control'),'no-store');assert.equal((await ops.json()).status,'never-run');
  const begin=await get('/api/x/oauth/start');assert.equal(begin.status,302);
  const login=new URL(begin.headers.get('location')), binding=begin.headers.getSetCookie()[0].split(';')[0];
  assert.equal(login.searchParams.get('scope'),'tweet.read users.read');assert.equal(login.searchParams.get('code_challenge_method'),'S256');
  const callback=`/api/x/oauth/callback?state=${login.searchParams.get('state')}&code=synthetic-code`;
  assert.equal((await get(callback)).status,400,'Callback from another browser is rejected.');
  // Restart between start and callback: PKCE and browser binding survive.
  await stop();await start();
  const accepted=await get(callback,binding);assert.equal(accepted.status,302);
  const session=accepted.headers.getSetCookie().find(cookie=>cookie.startsWith('funded_x_session=')).split(';')[0];
  assert.equal((await get(callback,binding)).status,400,'Callback replay is rejected.');
  const identity=await get('/api/x/me',session);assert.equal(identity.headers.get('cache-control'),'no-store');const identityBody=await identity.json();assert.equal(identityBody.configured,true);assert.equal(identityBody.user.id,'9000001');
  const settings=await(await get('/api/creator-support/me',session)).json();assert.ok(settings.csrf);
  const claims=await get('/api/x-fee/claims',session);assert.equal(claims.status,200);assert.deepEqual((await claims.json()).claims,[]);
  const receipts=await(await get('/api/evidence/receipts')).json();assert.equal(receipts.status,'no-records');assert.equal(receipts.scope,'verified-v3-collections');
  const readiness=await(await get('/api/readiness')).json();assert.equal(readiness.ready,false);assert.equal(readiness.scope,'configuration-only');
  await stop();await start();
  const postClaim=(action,input={})=>fetch(`${base}/api/sol-claims/http-claim/${action}`,{method:'POST',headers:{cookie:session,origin:base,'content-type':'application/json'},body:JSON.stringify({xHandle:'@fixture',...input})});
  for(const action of ['prepare','verify','attest','execute']){
    const retired=await postClaim(action);
    assert.equal(retired.status,410,`V2 ${action} must remain retired`);
  }
  await stop();await start();
  assert.equal((await(await get('/api/creator-support/me',session)).json()).csrf,settings.csrf);
  const preferences=await fetch(`${base}/api/creator-support/preferences`,{method:'POST',headers:{cookie:session,origin:base,'content-type':'application/json','x-creator-csrf':settings.csrf},body:JSON.stringify({following:['123']})});assert.equal(preferences.status,200);
  const logout=origin=>fetch(`${base}/api/x/logout`,{method:'POST',headers:{cookie:session,origin}});
  assert.equal((await logout('https://attacker.invalid')).status,403);
  assert.equal((await logout(base)).status,204);
  assert.equal((await(await get('/api/x/me',session)).json()).authenticated,false);
  for(const mode of ['token-network','token-credits','profile-network','profile-credits']){
    await stop();env.FUNDED_AUTH_HTTP_X_FAILURE=mode;await start();
    const attempt=await get('/api/x/oauth/start');assert.equal(attempt.status,302);
    const target=new URL(attempt.headers.get('location'));
    const cookie=attempt.headers.getSetCookie()[0].split(';')[0];
    const failed=await get(`/api/x/oauth/callback?state=${target.searchParams.get('state')}&code=synthetic-code`,cookie);
    assert.equal(failed.status,503,`${mode} must have a safe, actionable sign-in response`);
    assert.match(await failed.text(),mode.endsWith('credits')?/API credits/:/Start sign-in again/);
    assert.equal((await(await get('/api/x/me')).json()).authenticated,false);
  }
  await stop();
  delete env.FUNDED_AUTH_HTTP_X_FAILURE;
  env.X_CLIENT_ID='';env.X_CLIENT_SECRET='';
  await start();
  assert.equal((await(await get('/api/x/me')).json()).configured,false);
  assert.equal((await get('/api/x/oauth/start')).status,503);
  await stop();
  env.X_CLIENT_ID='synthetic-client';env.X_CLIENT_SECRET='synthetic-secret';env.X_CALLBACK_URL='https://example.test/wrong-path';
  await start();
  assert.equal((await(await get('/api/x/me')).json()).configured,false);
  assert.equal((await get('/api/x/oauth/start')).status,503);
  const persisted=await readFile(`${statePath}.auth.json`,'utf8');assert.ok(!persisted.includes('synthetic-token-not-persisted'));
  console.log('X auth HTTP: restart-safe OAuth/CSRF and V2 payout retirement passed with a mocked X provider. No payout or real OAuth.');
} finally {await stop();await rm(directory,{recursive:true,force:true});}
