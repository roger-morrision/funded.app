import assert from 'node:assert/strict';
import { createXUserResolver, xLookupHttpError } from '../server/x-user-lookup.mjs';

const result = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const response = data => result(200, { data });
const resolver = fetchUser => createXUserResolver({ getBearerToken: () => 'fixture-token', fetchUser, pause: async () => {} });

const success = resolver(async (url, options) => {
  assert.equal(url, 'https://api.x.com/2/users/by/username/JohnTrand83');
  assert.equal(options.headers.authorization, 'Bearer fixture-token');
  return response({ id: '2076871542202638336', username: 'johntrand83' });
});
assert.deepEqual(await success('@JohnTrand83'), { handle: '@johntrand83', id: '2076871542202638336' });
await assert.rejects(success('@invalid.handle'), error => {
  assert.match(error.message, /valid X handle/);
  assert.equal(xLookupHttpError(error)?.status, 400);
  return true;
});

for (const [status, message] of [[404, /not found/], [429, /rate limited/], [402, /credits/], [401, /credentials/], [403, /credentials/]]) {
  const lookup = resolver(async () => result(status));
  await assert.rejects(lookup('@missing'), error => {
    assert.match(error.message, message);
    assert.deepEqual(xLookupHttpError(error), { status: status === 404 ? 404 : 503, message: error.message });
    return true;
  });
  assert.equal(Boolean(lookup.health()), [401, 402, 403, 429].includes(status));
}

const creditRecovery = resolver(async handle => handle.endsWith('/restored')
  ? response({ id: '12345', username: 'restored' }) : result(402));
await assert.rejects(creditRecovery('@blocked'), /credits/);
assert.match(creditRecovery.health(), /credits/);
assert.equal((await creditRecovery('@restored')).id, '12345');
assert.equal(creditRecovery.health(), null);
let clock = 1_000;
const expiringFailure = createXUserResolver({ getBearerToken: () => 'fixture-token',
  fetchUser: async () => result(402), pause: async () => {}, now: () => clock });
await assert.rejects(expiringFailure('@blocked'), /credits/);
assert.match(expiringFailure.health(), /credits/);
clock += 60_000;
assert.equal(expiringFailure.health(), null, 'A stale provider failure must not disable launch controls indefinitely.');
assert.equal(xLookupHttpError(new Error('unexpected internal failure')), null);

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
