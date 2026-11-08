import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminEmailVerification,adminActionDigest,adminWriteNeedsEmail} from '../server/admin-email-verification.mjs';
import {deliverAdminCode} from '../server/admin-email-delivery.mjs';
import {createConfirmedAdminPost} from '../admin-email-confirmation.js';

function fixture(options={}){
  let time=1000000;const mail=[];
  const env={FUNDED_ADMIN_EMAIL:'admin@test.invalid'};
  const verify=createAdminEmailVerification({env,cluster:'devnet',origin:()=> 'https://funded.test',
    now:()=>time,configuration:()=>({to:env.FUNDED_ADMIN_EMAIL}),send:async value=>{mail.push(value);},...options});
  const request={sessionId:'session1',wallet:'admin1',method:'POST',path:'/api/admin/withdrawals/prepare',
    payload:{source:'treasury',destination:'recipient',amountLamports:1000000}};
  return{verify,request,mail,env,tick:ms=>{time+=ms;},async issue(){const result=await verify.issue(request);return{...request,id:result.id,code:mail.at(-1)?.code};}};
}

test('codes bind the entire action and are one-time, including concurrent reuse',async()=>{
  const f=fixture(),proof=await f.issue();assert.match(proof.code,/^\d{8}$/);
  assert.equal(f.mail[0].wallet,undefined);assert.equal(f.mail[0].payload,undefined);assert.equal(f.mail[0].sessionId,undefined);
  for(const change of [{sessionId:'other'},{wallet:'other'},{path:'/api/admin/fee-policy'},
    {payload:{...proof.payload,amountLamports:2000000}},{payload:{...proof.payload,destination:'attacker'}}])
    assert.throws(()=>f.verify.consume({...proof,...change}));
  const result=await Promise.allSettled([Promise.resolve().then(()=>f.verify.consume(proof)),Promise.resolve().then(()=>f.verify.consume(proof))]);
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1);
});
test('wrong code retry limit, expiry, new code, recipient changes and logout invalidate codes',async()=>{
  const f=fixture();let proof=await f.issue();
  const wrong=proof.code==='00000000'?'11111111':'00000000';
  for(let i=0;i<5;i++)assert.throws(()=>f.verify.consume({...proof,code:wrong}));
  assert.throws(()=>f.verify.consume(proof));
  f.tick(60000);proof=await f.issue();f.tick(300001);assert.throws(()=>f.verify.consume(proof));
  proof=await f.issue();f.tick(60000);const replacement=await f.issue();assert.throws(()=>f.verify.consume(proof));
  f.verify.revoke(replacement.sessionId);assert.throws(()=>f.verify.consume(replacement));
  f.tick(60000);proof=await f.issue();f.env.FUNDED_ADMIN_EMAIL='changed@test.invalid';assert.throws(()=>f.verify.consume(proof));
});
test('delivery failure, unset configuration and process restart fail closed',async()=>{
  const f=fixture({send:async()=>{throw Error('provider secret error');}});
  await assert.rejects(f.issue(),/could not be sent/);
  await assert.rejects(deliverAdminCode(),/not configured/);
  const noConfig=fixture({configuration:()=>{throw Error('missing');}});await assert.rejects(noConfig.issue(),/not configured/);
  const first=fixture(),proof=await first.issue();assert.throws(()=>fixture().verify.consume(proof));
});
test('mailbox throttling survives different sessions and prevents floods',async()=>{
  const f=fixture();await f.issue();
  await assert.rejects(f.verify.issue({...f.request,sessionId:'new'}),{status:429});
  for(let i=1;i<10;i++){f.tick(60000);await f.issue();}
  f.tick(60000);await assert.rejects(f.issue(),{status:429});
  f.tick(3600000);await f.issue();
});
test('logout during asynchronous delivery revokes the pending code',async()=>{
  let release;const f=fixture({send:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.verify.issue(f.request);f.verify.revoke(f.request.sessionId);release();
  await assert.rejects(pending,/expired/);
});
test('canonical request hashing is order-independent but type-, method- and path-sensitive',()=>{
  const digest=(payload,method='POST',path='/api/admin/settings')=>adminActionDigest(method,path,payload).digest;
  assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));
  assert.notEqual(digest({amount:1}),digest({amount:'1'}));
  assert.notEqual(digest({a:1}),digest({a:1},'PATCH'));
  for(const path of ['/api/admin/logout','/api/admin/settings?x=1','https://evil.test/','/api/admin/%73ettings'])
    assert.throws(()=>digest({},'POST',path));
  assert.throws(()=>digest({text:'x'.repeat(16001)}));
  assert.throws(()=>digest(JSON.parse('{"a":'+ '['.repeat(22)+'0'+']'.repeat(22)+'}')));
  assert(adminWriteNeedsEmail('PATCH','/api/admin/future-feature'));
  assert(!adminWriteNeedsEmail('GET','/api/admin/settings'));
});
test('browser freezes the reviewed payload, attaches proof, and never automatically retries',async()=>{
  const calls=[],session={active:true,epoch:1,current:value=>value===1};
  const input={amount:1};
  const post=createConfirmedAdminPost({session,api:async(path,options)=>{
    calls.push({path,options});if(path.endsWith('email-confirmation')){input.amount=2;return{id:'proof'};}
    throw Error('network outcome unknown');
  },confirm:async({payload,submit})=>{assert.equal(payload.amount,1);return submit('12345678');}});
  await assert.rejects(post('/api/admin/settings',input),/unknown/);
  assert.equal(calls.length,2);assert.equal(calls[1].options.body,'{"amount":1}');
  assert.equal(calls[1].options.headers['x-admin-confirmation-code'],'12345678');
});
test('browser will not submit after the session ends; auth and logout need no email',async()=>{
  const calls=[],session={active:true,epoch:1,current:()=>true};
  const post=createConfirmedAdminPost({session,api:async path=>{calls.push(path);return{id:'proof'};},
    confirm:async({submit})=>{session.active=false;return submit('12345678');}});
  await assert.rejects(post('/api/admin/settings',{}),/session ended/);
  assert.equal(calls.length,1);await post('/api/admin/logout',{});assert.equal(calls.at(-1),'/api/admin/logout');
  await assert.rejects(post('/api/tokens/legacy-financial-endpoint',{}),/email-protected admin endpoint/);
});
