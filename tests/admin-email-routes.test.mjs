import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createAdminRoutes} from '../server/routes/admin.mjs';
import {serviceFeeSnapshot} from '../server/service-fees.mjs';
import {ADMIN_EMAIL_AUTHORIZED} from '../server/admin-email-verification.mjs';
import {createV3RewardFundingRoutes} from '../server/routes/v3-reward-funding.mjs';

test('real HTTP admin handlers require wallet signature plus exact email proof before writes',{timeout:20000},async()=>{
  const signer=Keypair.generate(),outsider=Keypair.generate(),state={},mail=[],residualCalls=[];let now=Date.now(),cookie='',bodyReads=0,failAudit=false;
  const env={FUNDED_ADMIN_WALLETS:signer.publicKey.toBase58(),FUNDED_ADMIN_EMAIL:'admin@test.invalid'};
  const store={read:async()=>state,update:async fn=>{if(failAudit)throw Error('database down');return fn(state);}};
  const handler=createAdminRoutes({env,store,solanaCluster:'devnet',solanaRpcUrl:'http://unused.invalid',
    body:async req=>{bodyReads++;let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text||'{}');},
    respond:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},
    emailVerificationOptions:{now:()=>now,configuration:()=>({to:env.FUNDED_ADMIN_EMAIL}),send:async value=>mail.push(value)},
    residualTransferFactory:({body,respond})=>async(req,res,url)=>{
      assert.equal(req[ADMIN_EMAIL_AUTHORIZED]?.path,'/api/admin/v3-allocations/transfer');
      residualCalls.push({input:await body(req),path:url.pathname});respond(res,200,{status:'mocked-no-transfer'});return true;
    }});
  const server=createServer(async(req,res)=>{
    try{if(!await handler(req,res,new URL(req.url,env.PUBLIC_APP_URL))){res.writeHead(404);res.end('{}');}}
    catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');env.PUBLIC_APP_URL=`http://127.0.0.1:${server.address().port}`;
  async function request(path,payload,headers={},method=payload===undefined?'GET':'POST'){
    const response=await fetch(env.PUBLIC_APP_URL+path,{method,headers:{origin:env.PUBLIC_APP_URL,cookie,'content-type':'application/json',...headers},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    return{status:response.status,data:await response.json()};
  }
  async function login(){
    const wallet=signer.publicKey.toBase58(),challenge=(await request('/api/admin/challenge',{wallet})).data;
    const result=await request('/api/admin/session',{wallet,nonce:challenge.nonce,
      signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),signer.secretKey))});
    assert.equal(result.status,200);return challenge;
  }
  async function confirmation(path,payload){
    now+=60001;const result=await request('/api/admin/email-confirmation',{method:'POST',path,payload});
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.code,undefined);
    return{'x-admin-confirmation-id':result.data.id,'x-admin-confirmation-code':mail.at(-1).code};
  }
  try{
    assert.equal((await request('/api/admin/email-confirmation',{})).status,401);
    assert.equal((await request('/api/admin/challenge',{wallet:outsider.publicKey.toBase58()})).status,403);
    const challenge=await login();
    assert.equal((await request('/api/admin/session',{wallet:signer.publicKey.toBase58(),nonce:challenge.nonce,signature:'bad'})).status,401);
    assert.equal((await request('/api/admin/service-fees')).status,200);
    const paths=['service-fees','fee-policy','withdrawals/prepare','withdrawals/verify','withdrawals/reconcile',
      'agency-rules','agency-fee-policy','daily-bonus/snapshot','daily-bonus/review','daily-bonus/reconcile',
      'v3-allocations/review','v3-allocations/approve','v3-allocations/transfer','x-posts/review','x-posts/pause','product-issues/'+'a'.repeat(32),'future-feature'];
    for(const path of paths)assert.equal((await request('/api/admin/'+path,{})).status,403,path);
    for(const method of ['PATCH','PUT','DELETE'])assert.equal((await request('/api/admin/settings',{}, {},method)).status,403);
    assert.deepEqual(state,{});
    assert.equal(residualCalls.length,0);
    assert.equal((await request('/api/admin/service-fees?unbound=true',{})).status,400);
    assert.equal((await request('/api/admin/service-fees',{}, {origin:'https://evil.test'})).status,403);
    const snapshot=serviceFeeSnapshot(state),payload={policy:snapshot.policy,expectedRevision:0,expectedHash:snapshot.hash,reason:'Verified admin test update'};
    const proof=await confirmation('/api/admin/service-fees',payload);
    assert.equal((await request('/api/admin/service-fees',{...payload,reason:'Tampered reason'},proof)).status,403);
    assert.equal(state.adminSettings,undefined);
    const before=bodyReads,result=await request('/api/admin/service-fees',payload,proof);
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(bodyReads-before,1);assert.equal(result.data.revision,1);
    assert.equal((await request('/api/admin/service-fees',payload,proof)).status,403);
    assert.equal(Object.values(state.adminAudit).filter(row=>row.action==='email-confirmation-consumed').length,1);
    assert(!JSON.stringify(state).includes(proof['x-admin-confirmation-code']));
    const auditProof=await confirmation('/api/admin/service-fees',payload);failAudit=true;
    assert.equal((await request('/api/admin/service-fees',payload,auditProof)).status,503);failAudit=false;
    assert.equal((await request('/api/admin/service-fees',payload,auditProof)).status,403);
    const transfer={mint:signer.publicKey.toBase58(),kind:'creator-wallet',collectionSignature:'2'.repeat(88),residualPlanHash:'a'.repeat(64)};
    const transferProof=await confirmation('/api/admin/v3-allocations/transfer',transfer);
    assert.equal((await request('/api/admin/v3-allocations/transfer',transfer,transferProof)).status,200);
    assert.equal(residualCalls.length,1);assert.deepEqual(residualCalls[0].input,transfer);
    assert.equal(residualCalls[0].path,`/api/tokens/${transfer.mint}/v3-creator-wallet-payout/${transfer.collectionSignature}`);
    const replacedProof=await confirmation('/api/admin/service-fees',payload),oldCookie=cookie;await login();
    assert.equal((await request('/api/admin/service-fees',undefined,{cookie:oldCookie})).status,401);
    assert.equal((await request('/api/admin/service-fees',payload,replacedProof)).status,403);
    const logoutProof=await confirmation('/api/admin/service-fees',payload);
    assert.equal((await request('/api/admin/logout',{})).status,200);await login();
    assert.equal((await request('/api/admin/service-fees',payload,logoutProof)).status,403);
    env.FUNDED_ADMIN_WALLETS='';assert.equal((await request('/api/admin/service-fees')).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('shared financial endpoint rejects residuals with spoofed HTTP approval fields before RPC or storage',async()=>{
  const mint=Keypair.generate().publicKey.toBase58();let response;
  const handler=createV3RewardFundingRoutes({solanaCluster:'devnet',solanaRpcUrl:'http://unused.invalid',
    env:{CORS_ORIGIN:'https://funded.test',FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED:'true'},
    body:async()=>({residualPlanHash:'a'.repeat(64),adminEmailAuthorized:true}),
    store:{read:()=>{throw Error('must not read storage');}},connectionFactory:()=>{throw Error('must not read RPC');},
    respond:(_res,status,data)=>{response={status,data};}});
  await handler({method:'POST',headers:{origin:'https://funded.test','x-admin-confirmation-code':'12345678','x-admin-email-authorized':'true'}},{},
    new URL(`https://funded.test/api/tokens/${mint}/v3-creator-wallet-payout/${'2'.repeat(88)}`));
  assert.equal(response.status,403);assert.match(response.data.error,/email confirmation/);
});
