import assert from 'node:assert/strict';
import { createXUserResolver } from '../server/x-user-lookup.mjs';

const result = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const response = data => result(200, { data });
const resolver = fetchUser => createXUserResolver({ getBearerToken: () => 'fixture-token', fetchUser, pause: async () => {} });

const success = resolver(async (url, options) => {
  assert.equal(url, 'https://api.x.com/2/users/by/username/JohnTrand83');
  assert.equal(options.headers.authorization, 'Bearer fixture-token');
  return response({ id: '2076871542202638336', username: 'johntrand83' });
});
assert.deepEqual(await success('@JohnTrand83'), { handle: '@johntrand83', id: '2076871542202638336' });
await assert.rejects(success('@invalid.handle'), /valid X handle/);

for (const [status, message] of [[404, /not found/], [429, /rate limited/], [402, /credits/], [401, /credentials/], [403, /credentials/]]) {
  await assert.rejects(resolver(async () => result(status))('@missing'), message);
}

let attempts = 0;
const recovered = resolver(async () => {
  attempts += 1;
  return attempts === 1 ? result(503) : response({ id: '12345', username: 'retry' });
});
assert.equal((await recovered('@retry')).id, '12345');
assert.equal(attempts, 2);

attempts = 0;
await assert.rejects(resolver(async () => { attempts += 1; throw new Error('network'); })('@retry'), /timed out or lost its connection/);
assert.equal(attempts, 2);
await assert.rejects(resolver(async () => response({ id: '12345', username: 'other' }))('@retry'), /unexpected identity/);

console.log('X user lookup verifies stable IDs, diagnoses X failures, and retries temporary failures.');
