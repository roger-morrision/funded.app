import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createCreatorSupportHandler } from '../server/creator-support.mjs';
const session = {user:{id:'123',username:'fixture'},creatorCsrf:'csrf'};
test('the authenticated API explicitly advertises scheduling support', async () => {
  let output;
  const handler = createCreatorSupportHandler({cluster:'devnet',getSession:async()=>session,
    store:{chargeRpcRate:async()=>true,readCreatorState:async()=>({creatorProfiles:{},launches:{}})}});
  await handler({method:'GET',headers:{},socket:{}},{writeHead(){},end(body){output=JSON.parse(body);}},new URL('http://127.0.0.1:8787/api/creator-support/me'));
  assert.deepEqual(output.announcements,{scheduling:true,maxPending:10,maxDays:30});
});
async function request({body, profile = {id:'123',identityVerified:true,listed:true}, auth = session, csrf = 'csrf', origin = 'http://127.0.0.1:8787', cluster = 'devnet'}) {
  const state = {creatorProfiles:{'123':profile}}, req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST'; req.socket = {remoteAddress:'127.0.0.1'};
  req.headers = {host:'127.0.0.1:8787',origin,'x-creator-csrf':csrf};
  let status, result, writes = 0;
  const handler = createCreatorSupportHandler({cluster,getSession:async()=>auth,
    store:{chargeRpcRate:async()=>true,updateCreatorProfile:async(id,mutate)=>{assert.equal(id,'123');writes++;return mutate(state);}}});
  await handler(req,{writeHead(code){status=code;},setHeader(){},end(text){result=JSON.parse(text);}},new URL('http://127.0.0.1:8787/api/creator-support/updates'));
  return {status,result,writes,state};
}
test('scheduled announcement writes require Devnet, verified session, origin, and CSRF', async()=>{
  for (const [input,status] of [[{auth:null},401],[{csrf:'wrong'},403],[{origin:'https://other.example'},403],[{cluster:'mainnet-beta'},503]]) {
    const response = await request({body:{text:'Update'},...input}); assert.equal(response.status,status); assert.equal(response.writes,0);
  }
  const excluded = await request({body:{text:'Update'},profile:{identityVerified:true,listed:true,optedOut:true}});
  assert.equal(excluded.status,400);
});
test('authenticated owner can schedule and cancel; invalid time fails without adding an update',async()=>{
  const publishAt = new Date(Date.now() + 600000).toISOString();
  const response = await request({body:{text:'Scheduled progress',publishAt}});
  assert.equal(response.status,200); assert.equal(response.result.publishAt,publishAt);
  const cancelled = await request({body:{cancelId:response.result.id},profile:response.state.creatorProfiles['123']});
  assert.equal(cancelled.status,200);assert.equal(cancelled.result.cancelled,true);assert.equal(cancelled.state.creatorProfiles['123'].updates.length,0);
  const invalid = await request({body:{text:'Bad time',publishAt:'not-a-time'}});
  assert.equal(invalid.status,400);assert.equal(invalid.state.creatorProfiles['123'].updates,undefined);
});
