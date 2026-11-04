import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {createAdminRoutes} from '../server/routes/admin.mjs';
import {createProductIssueRoutes} from '../server/routes/product-issues.mjs';
import {handleIssueAdmin} from '../server/routes/issue-admin.mjs';

const id='a'.repeat(32),time='2026-11-01T00:00:00.000Z';
function fixture(){
  const state={productIssues:{[id]:{id,status:'received',note:'',createdAt:time,updatedAt:time}}};
  const store={read:async()=>state,update:async fn=>fn(state)};
  return {state,async post(input){let result;await handleIssueAdmin({method:'POST'},{},new URL(`http://localhost/api/admin/product-issues/${id}`),{store,body:async()=>input,json:(_res,status,data)=>{result={status,data};return true;}});return result;}};
}
test('issue review rejects stale or missing versions and preserves the last reviewed note',async()=>{
  const f=fixture();
  const first=await f.post({status:'investigating',note:'First administrator review',expectedUpdatedAt:time});assert.equal(first.status,200);assert.notEqual(first.data.updatedAt,time);
  const stale=await f.post({status:'fixed',note:'Stale administrator review',expectedUpdatedAt:time});assert.equal(stale.status,409);assert.equal(f.state.productIssues[id].note,'First administrator review');
  const missing=await f.post({status:'fixed',note:'No reviewed version'});assert.equal(missing.status,400);
  assert.equal((await f.post({status:'fixed',note:'Fresh administrator review',expectedUpdatedAt:first.data.updatedAt})).status,200);
});
test('malformed issue review input is a validation error and leaves the report intact',async()=>{
  const f=fixture();for(const input of [null,[],{},'invalid',{status:'fixed',note:'a'.repeat(501),expectedUpdatedAt:time}])assert.equal((await f.post(input)).status,400);
  assert.equal(f.state.productIssues[id].status,'received');
});

test('real signed HTTP protects issue reviews and rejects conflicting writes without RPC',async()=>{
  const admin=Keypair.generate(),wallet=admin.publicKey.toBase58(),f=fixture();let origin;
  const store={read:async()=>structuredClone(f.state),update:async fn=>fn(f.state)};
  const respond=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  const body=async req=>{let text='';for await(const chunk of req)text+=chunk;return text?JSON.parse(text):null;};
  const env={FUNDED_ADMIN_WALLETS:wallet};
  const handler=createAdminRoutes({store,body,respond,solanaCluster:'devnet',env,connectionFactory:()=>{throw Error('Issue review must not call RPC.');}});
  const server=createServer(async(req,res)=>{try{if(!await handler(req,res,new URL(req.url,origin)))respond(res,404,{});}catch{respond(res,500,{error:'Unexpected failure'});}});
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;env.PUBLIC_APP_URL=origin;
    const post=(path,input,cookie='',requestOrigin=origin)=>fetch(origin+path,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json',cookie},body:JSON.stringify(input)});
    const path=`/api/admin/product-issues/${id}`,input={status:'investigating',note:'Actual HTTP QA review',expectedUpdatedAt:time};
    assert.equal((await post(path,input)).status,401);
    const challenge=await(await post('/api/admin/challenge',{wallet})).json();
    const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),admin.secretKey));
    const session=await post('/api/admin/session',{wallet,nonce:challenge.nonce,signature});assert.equal(session.status,200);
    const cookie=session.headers.get('set-cookie').split(';')[0];
    assert.equal((await post(path,input,cookie,'https://untrusted.invalid')).status,403);
    const listed=await(await fetch(origin+'/api/admin/product-issues',{headers:{cookie}})).json();assert.equal(listed.reports[0].updatedAt,time);
    assert.equal((await post(path,input,cookie)).status,200);
    assert.equal((await post(path,{...input,status:'fixed',note:'Stale HTTP review'},cookie)).status,409);
    assert.equal((await post(path,null,cookie)).status,400);assert.equal(f.state.productIssues[id].note,input.note);
    assert.equal((await post('/api/admin/logout',{},cookie)).status,200);assert.equal((await post(path,input,cookie)).status,401);
  }finally{admin.secretKey.fill(0);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('the legacy operator endpoint uses the same reviewed-version conflict check',async()=>{
  const f=fixture(),store={read:async()=>f.state,update:async fn=>fn(f.state)};
  const handler=createProductIssueRoutes({store,cluster:'devnet',requireAuthorized:()=>true});
  const {Readable}=await import('node:stream');
  async function post(input){
    const req=Readable.from([Buffer.from(JSON.stringify(input))]);Object.assign(req,{method:'POST',headers:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787'},socket:{}});
    let result;const res={writeHead(status){result={status};},end(text){result.data=JSON.parse(text);}};
    await handler(req,res,new URL(`http://127.0.0.1:8787/api/creator-support/issues/${id}/status`));return result;
  }
  const input={status:'investigating',note:'Legacy operator review',expectedUpdatedAt:time};
  assert.equal((await post(input)).status,200);assert.equal((await post({...input,status:'fixed'})).status,409);await assert.rejects(()=>post(null),{statusCode:400});
});
