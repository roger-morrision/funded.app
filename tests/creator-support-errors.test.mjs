import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createCreatorSupportHandler } from '../server/creator-support.mjs';

async function updateProfile(store, input) {
  const req = Readable.from([Buffer.from(JSON.stringify(input))]);
  req.method = 'POST';
  req.headers = { host:'127.0.0.1:8787', origin:'http://127.0.0.1:8787', 'x-creator-csrf':'fixture-csrf' };
  req.socket = { remoteAddress:'127.0.0.1' };
  let status, body;
  const res = { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = JSON.parse(value); } };
  const handler = createCreatorSupportHandler({ store:{ chargeRpcRate:async () => true, ...store }, cluster:'devnet',
    getSession:async () => ({ user:{ id:'123', username:'fixture' }, creatorCsrf:'fixture-csrf' }) });
  await handler(req, res, new URL('http://127.0.0.1:8787/api/creator-support/profile'));
  return { status, body };
}

test('creator storage failures do not become public validation errors or expose dependency details', async () => {
  const result = await updateProfile({ updateCreatorProfile:async () => { throw new Error('postgresql://operator:secret@private-db/ledger'); } },
    { listed:true, optedOut:false, authorizedMints:[] });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /could not be saved.*refresh/i);
  assert.doesNotMatch(result.body.error, /secret|postgresql|private-db/);
});

test('creator input mistakes retain an actionable client response', async () => {
  const result = await updateProfile({ updateCreatorProfile:async (_id, mutate) => mutate({}) }, { listed:'invalid' });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /listing.*consent/i);
});
