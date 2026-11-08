import test from 'node:test';
import assert from 'node:assert/strict';
import {adminEmailConfig,deliverAdminCode} from '../server/admin-email-delivery.mjs';

const env={FUNDED_ADMIN_EMAIL_PROVIDER:'resend',FUNDED_ADMIN_EMAIL:'admin@funded.test',
  FUNDED_ADMIN_EMAIL_FROM:'security@funded.test',FUNDED_ADMIN_EMAIL_API_KEY:'test-key-not-a-credential'};
const input={env,to:env.FUNDED_ADMIN_EMAIL,id:'test-confirmation',code:'12345678',path:'/api/admin/withdrawals/prepare',
  cluster:'devnet',origin:'https://funded.test',expiresAt:Date.UTC(2026,10,8),digest:'a'.repeat(64),
  wallet:'DO_NOT_TRANSMIT_WALLET',payload:{amount:123456789,privateKey:'DO_NOT_TRANSMIT_PAYLOAD'}};

test('Resend receives only the approved disclosure; endpoint is fixed with timeout and no redirects',async()=>{
  let called=0;
  await deliverAdminCode({...input,fetchImpl:async(url,options)=>{
    called++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.redirect,'error');
    assert(options.signal instanceof AbortSignal);assert.equal(options.headers['Idempotency-Key'],input.id);
    assert.equal(options.headers.authorization,`Bearer ${env.FUNDED_ADMIN_EMAIL_API_KEY}`);
    const body=JSON.parse(options.body);assert.deepEqual(body.to,[env.FUNDED_ADMIN_EMAIL]);
    assert.match(body.text,/12345678/);assert.match(body.text,/Treasury withdrawal/);
    for(const value of ['DO_NOT_TRANSMIT',String(input.payload.amount),input.path,env.FUNDED_ADMIN_EMAIL_API_KEY])
      assert(!options.body.includes(value));
    return{ok:true,json:async()=>({id:'provider-accepted'})};
  }});assert.equal(called,1);
});
test('missing config, changed recipient and provider failures never fall back or retry',async()=>{
  for(const change of [{FUNDED_ADMIN_EMAIL_PROVIDER:''},{FUNDED_ADMIN_EMAIL_FROM:'REPLACE_WITH_SENDER'},
    {FUNDED_ADMIN_EMAIL:'bad'},{FUNDED_ADMIN_EMAIL_API_KEY:''},
    {FUNDED_ADMIN_EMAIL_API_KEY:'',FUNDED_ADMIN_EMAIL_API_KEY_FILE:'missing-test-secret-file'}])
    assert.throws(()=>adminEmailConfig({...env,...change}),/not configured/);
  let called=0;const fetchImpl=async()=>{called++;return{ok:false};};
  await assert.rejects(deliverAdminCode({...input,to:'attacker@funded.test',fetchImpl}),/recipient changed/);assert.equal(called,0);
  await assert.rejects(deliverAdminCode({...input,fetchImpl}),/could not be sent/);assert.equal(called,1);
  await assert.rejects(deliverAdminCode({...input,fetchImpl:async()=>({ok:true,json:async()=>({})})}),/not acknowledged/);
});
