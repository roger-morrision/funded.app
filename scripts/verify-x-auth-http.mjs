import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createStore } from '../server/store.mjs';

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
  const identity=await get('/api/x/me',session);assert.equal(identity.headers.get('cache-control'),'no-store');assert.equal((await identity.json()).user.id,'9000001');
  const settings=await(await get('/api/creator-support/me',session)).json();assert.ok(settings.csrf);
  const claims=await get('/api/x-fee/claims',session);assert.equal(claims.status,200);assert.deepEqual((await claims.json()).claims,[]);
  const receipts=await(await get('/api/evidence/receipts')).json();assert.equal(receipts.status,'no-records');assert.equal(receipts.scope,'global-recent');
  const readiness=await(await get('/api/readiness')).json();assert.equal(readiness.ready,false);assert.equal(readiness.scope,'configuration-only');
  // Add only synthetic entitlement data while the API is stopped. Signing keys stay in memory.
  await stop();
  const fixtureStore=createStore(statePath,'');
  await fixtureStore.update(state=>{
    state.obligations['http-claim']={id:'http-claim',recipient:'@fixture',xUserId:'9000001',amountLamports:'1000000',source:'verified-per-mint-router-collection',cluster:'devnet'};
    state.claims['http-claim']={id:'http-claim',recipient:'@fixture',xUserId:'9000001',obligationId:'http-claim',nonce:'expired-nonce',status:'awaiting-wallet-signature',expiresAt:new Date(0).toISOString()};
  });
  await start();
  const postClaim=(action,input={})=>fetch(`${base}/api/sol-claims/http-claim/${action}`,{method:'POST',headers:{cookie:session,origin:base,'content-type':'application/json'},body:JSON.stringify({xHandle:'@fixture',...input})});
  const prepare=await postClaim('prepare');assert.equal(prepare.status,200);const challenge=await prepare.json();
  assert.ok(!challenge.statement.includes('expired-nonce'));
  const wallet=nacl.sign.keyPair(),otherWallet=nacl.sign.keyPair();
  const signed=(key,statement=challenge.statement)=>({publicKey:bs58.encode(key.publicKey),signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(statement),key.secretKey))});
  assert.equal((await postClaim('verify',signed(wallet,'funded.app SOL claim http-claim for @fixture nonce expired-nonce'))).status,401);
  const verified=await postClaim('verify',signed(wallet));assert.equal(verified.status,200);assert.equal((await verified.json()).status,'wallet-verified');
  assert.equal((await postClaim('verify',signed(otherWallet))).status,409,'Original wallet cannot be replaced.');
  const attested=await postClaim('attest');assert.equal(attested.status,200);assert.equal((await attested.json()).status,'ready-to-execute');
  assert.equal((await(await postClaim('prepare')).json()).boundWallet,bs58.encode(wallet.publicKey));
  await stop();
  await createStore(statePath,'').updateClaimState('http-claim',state=>{state.claims['http-claim'].status='verification-pending';});
  await start();
  assert.equal((await(await postClaim('verify',signed(wallet))).json()).status,'verification-pending','Reverification cannot rearm uncertain execution.');
  assert.equal((await(await postClaim('attest')).json()).status,'verification-pending');
  await stop();await start();
  assert.equal((await(await get('/api/creator-support/me',session)).json()).csrf,settings.csrf);
  const preferences=await fetch(`${base}/api/creator-support/preferences`,{method:'POST',headers:{cookie:session,origin:base,'content-type':'application/json','x-creator-csrf':settings.csrf},body:JSON.stringify({following:['123']})});assert.equal(preferences.status,200);
  const logout=origin=>fetch(`${base}/api/x/logout`,{method:'POST',headers:{cookie:session,origin}});
  assert.equal((await logout('https://attacker.invalid')).status,403);
  assert.equal((await logout(base)).status,204);
  assert.equal((await(await get('/api/x/me',session)).json()).authenticated,false);
  const persisted=await readFile(`${statePath}.auth.json`,'utf8');assert.ok(!persisted.includes('synthetic-token-not-persisted'));
  console.log('X auth HTTP: restart-safe OAuth/CSRF, scoped claim renewal, old-signature rejection, original-wallet binding, attestation and uncertainty preservation passed with mocked X provider and ephemeral signing keys. No payout or real OAuth.');
} finally {await stop();await rm(directory,{recursive:true,force:true});}
