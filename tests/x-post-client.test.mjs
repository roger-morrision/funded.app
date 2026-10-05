import test from 'node:test';
import assert from 'node:assert/strict';
import { createXPublisher } from '../server/x-post-client.mjs';

const event = { text: '[Devnet test] Synthetic fixture only' };
test('publisher contacts only fixed HTTPS endpoints and refuses redirects', async () => {
  const calls = [];
  const publisher = createXPublisher({ accessToken: 'synthetic-private-token', expectedHandle: '@FundedFixture', expectedAccountId: '123', fetchImpl: async (url, options) => {
    calls.push({url,options});
    return Response.json(url.endsWith('/users/me') ? {data:{id:'123',username:'fundedfixture'}} : {data:{id:'456'}});
  } });
  await assert.rejects(publisher.publish(event), /Verify/);
  assert.equal(calls.length,0);
  assert.deepEqual(await publisher.verifyAccount(), {id:'123',handle:'fundedfixture'});
  assert.deepEqual(await publisher.publish(event), {id:'456',url:'https://x.com/i/web/status/456'});
  assert.deepEqual(calls.map(call=>call.url), ['https://api.x.com/2/users/me','https://api.x.com/2/tweets']);
  for(const {options} of calls) assert.equal(options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[1].options.body), {text:event.text});
});
test('account identity mismatch and failed reverification revoke any earlier posting approval', async () => {
  let account={id:'123',username:'fundedfixture'}, posts=0;
  const publisher=createXPublisher({accessToken:'synthetic-token',expectedHandle:'FundedFixture',expectedAccountId:'123',fetchImpl:async(url)=>{
    if(url.endsWith('/users/me'))return Response.json({data:account});
    posts++;return Response.json({data:{id:'456'}});
  }});
  await publisher.verifyAccount();
  account={id:'999',username:'fundedfixture'};
  await assert.rejects(publisher.verifyAccount(),/different account/);
  await assert.rejects(publisher.publish(event),/Verify/);
  account={id:'123',username:'otheraccount'};
  await assert.rejects(publisher.verifyAccount(),/different account/);
  await assert.rejects(publisher.publish(event),/Verify/);
  assert.equal(posts,0);
});
test('transport failures never expose provider bodies or access tokens in errors', async () => {
  let response=Response.json({data:{id:'123',username:'fundedfixture'}});
  const publisher=createXPublisher({accessToken:'synthetic-private-token',expectedHandle:'fundedfixture',fetchImpl:async()=>response});
  await publisher.verifyAccount();
  for(const status of [401,402,403,408,429,503]){
    response=new Response('provider echoed synthetic-private-token',{status});
    await assert.rejects(publisher.publish(event),error=>{
      assert.doesNotMatch(error.message,/synthetic-private-token|provider echoed/);
      assert.equal(error.status,status);
      assert.equal(error.delivery,status===429?'not-sent':[401,402,403].includes(status)?'rejected':'unknown');
      if(status===401)assert.match(error.message,/publishing credentials/);
      if(status===402)assert.match(error.message,/credits/);
      return true;
    });
  }
});
