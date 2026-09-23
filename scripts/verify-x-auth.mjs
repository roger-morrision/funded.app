import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createXAuth, cookieValue, callbackUrlFor, authCookie, allowedAuthOrigin } from '../server/x-auth.mjs';

export async function verifyAuthStore(store, restarted, dump) {
  const auth = createXAuth(store), other = createXAuth(restarted);
  const user = { id: '9000001', username: 'fixture', name: 'Synthetic QA identity', accessToken: 'must-not-store' };
  const token = await auth.issue(user);
  const session = await other.session(token);
  assert.equal(session.user.id, user.id);
  assert.match(session.creatorCsrf, /^[0-9a-f]{48}$/);
  assert.equal((await auth.session(token)).creatorCsrf, session.creatorCsrf, 'CSRF must survive process/store recreation.');
  assert.equal(session.user.accessToken, undefined);
  assert.equal(await auth.session('malformed'), null);
  const persisted = await dump();
  assert.ok(!persisted.includes(token), 'Raw bearer cookie must not be persisted.');
  assert.ok(!persisted.includes('must-not-store'));
  assert.ok(!JSON.stringify(await store.read()).includes(session.creatorCsrf), 'Auth must be separate from public/ledger reads.');
  await other.revoke(token); assert.equal(await auth.session(token), null);
  const flow = await auth.start('https://example.test/api/x/oauth/callback');
  assert.equal(await other.consume(flow.state, 'x'.repeat(43)), null, 'Wrong browser cannot consume the request.');
  const results = await Promise.all([other.consume(flow.state, flow.binding), other.consume(flow.state, flow.binding)]);
  assert.equal(results.filter(Boolean).length, 1, 'Callback may only be consumed once.');
  const request = results.find(Boolean);
  assert.equal(request.callbackUrl, 'https://example.test/api/x/oauth/callback');
  assert.equal(createHash('sha256').update(request.verifier).digest('base64url'), flow.challenge);
  assert.equal(await auth.consume(flow.state, flow.binding), null);
  const expired = 'e'.repeat(43), hash = createHash('sha256').update(expired).digest('hex');
  await store.authPut('session', hash, { user }, Date.now()-1000);
  assert.equal(await other.session(expired), null);
  await store.authPut('oauth', 'expired-fixture', { verifier: 'expired' }, Date.now()-1000);
  assert.equal(await restarted.authTake('oauth', 'expired-fixture'), null);
}

if (process.argv[1]?.endsWith('verify-x-auth.mjs')) {
  const directory = await mkdtemp(join(tmpdir(), 'funded-auth-fixture-'));
  try {
    const path = join(directory, 'state.json');
    const store = createStore(path, '');
    // Local file fallback is single-process. Recreated store used only for sequential reads/revocation.
    await verifyAuthStore(store, createStore(path, ''), () => readFile(`${path}.auth.json`, 'utf8'));
    assert.equal(cookieValue({headers:{cookie:'a=1;funded_x_session=abc'}}, 'funded_x_session'), 'abc');
    assert.equal(cookieValue({headers:{cookie:'funded_x_session=%bad'}}, 'funded_x_session'), '');
    assert.equal(cookieValue({headers:{cookie:'funded_x_session=a; funded_x_session=b'}}, 'funded_x_session'), '');
    const local = {headers:{host:'127.0.0.1:8787', origin:'http://127.0.0.1:8787'},socket:{}};
    assert.equal(callbackUrlFor(local, ''), 'http://127.0.0.1:8787/api/x/oauth/callback');
    assert.throws(() => callbackUrlFor(local, '', true));
    assert.throws(() => callbackUrlFor({headers:{host:'attacker.invalid'}}, ''));
    assert.throws(() => callbackUrlFor(local, 'https://user:secret@example.test/api/x/oauth/callback'));
    assert.equal(allowedAuthOrigin(local, undefined), true);
    assert.equal(allowedAuthOrigin(local, 'https://example.test'), false);
    assert.match(authCookie('funded_x_session','fixture',86400,'https://example.test'), /HttpOnly; SameSite=Lax; Path=\/; Max-Age=86400; Secure$/);
    console.log('X auth: local restart, hashed bearer storage, CSRF persistence, single-use/browser-bound PKCE, expiry, logout and origin checks passed. Real X OAuth not exercised.');
  } finally { await rm(directory, {recursive:true,force:true}); }
}
