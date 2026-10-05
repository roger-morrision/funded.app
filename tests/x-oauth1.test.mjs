import assert from 'node:assert/strict';
import test from 'node:test';
import { oauth1Signature, xOAuth1Authorization } from '../server/x-oauth1.mjs';
import { createXPublisher } from '../server/x-post-client.mjs';

const oauth1 = { apiKey: 'fixture-consumer', apiSecret: 'fixture-consumer-secret',
  accessToken: '123-fixture-token', accessTokenSecret: 'fixture-token-secret' };

test('OAuth 1.0a signer matches the published GET signature vector', () => {
  assert.equal(oauth1Signature({ method: 'GET', url: new URL('http://photos.example.net/photos?file=vacation.jpg&size=original'),
    apiKey: 'dpf43f3p2l4k3l03', apiSecret: 'kd94hf93k423kf44', accessToken: 'nnch734d00sl2jdk',
    accessTokenSecret: 'pfkkdhi9sl3r4s00', nonce: 'kllo9940pd9333jh', timestamp: 1191242096 }),
  'tR3+Ty81lMeYAr/Fid0kMTYa/WM=');
  assert.throws(() => xOAuth1Authorization({ method: 'GET', url: new URL('https://example.com/2/users/me'), ...oauth1 }), /target/);
});

test('OAuth 1.0a publisher verifies the target account before signing a JSON post', async () => {
  const calls = [];
  const publisher = createXPublisher({ oauth1, expectedHandle: 'fundedvip', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/verify_credentials.json')
      ? Response.json({ id_str: '123', screen_name: 'fundedvip' })
      : Response.json({ data: { id: '456' } });
  } });
  await assert.rejects(publisher.publish({ text: 'fixture' }), /Verify/);
  assert.deepEqual(await publisher.verifyAccount(), { id: '123', handle: 'fundedvip' });
  assert.deepEqual(await publisher.publish({ text: '[Devnet test] fixture' }),
    { id: '456', url: 'https://x.com/i/web/status/456' });
  assert.deepEqual(calls.map(call => call.url),
    ['https://api.x.com/1.1/account/verify_credentials.json', 'https://api.x.com/2/tweets']);
  for (const call of calls) {
    assert.match(call.options.headers.authorization, /^OAuth oauth_consumer_key=/);
    assert.doesNotMatch(call.options.headers.authorization, /fixture-consumer-secret|fixture-token-secret/);
    assert.equal(call.options.redirect, 'error');
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), { text: '[Devnet test] fixture' });
});

test('OAuth 1.0a account mismatch or provider billing failure cannot publish', async () => {
  let posts = 0;
  const mismatched = createXPublisher({ oauth1, expectedHandle: 'fundedvip', fetchImpl: async () => {
    posts += 1; return Response.json({ id_str: '123', screen_name: 'another' });
  } });
  await assert.rejects(mismatched.verifyAccount(), /different account/);
  await assert.rejects(mismatched.publish({ text: 'fixture' }), /Verify/);
  assert.equal(posts, 1);
  const billed = createXPublisher({ oauth1, expectedHandle: 'fundedvip', fetchImpl: async () => new Response('secret response', { status: 402 }) });
  await assert.rejects(billed.verifyAccount(), error => error.status === 402 && !error.message.includes('secret response'));
});
