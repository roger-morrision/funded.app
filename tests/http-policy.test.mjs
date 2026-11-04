import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHttpPolicy, publicError, staticCacheControl, transientDependencyCode, validateInput } from '../server/http-policy.mjs';

test('only hashed build assets receive immutable caching', () => {
  for (const path of ['index.html', 'app.js', 'styles.css', 'favicon.svg', 'assets/app.js', 'images/logo-deadbeef.png']) assert.equal(staticCacheControl(path), 'no-cache');
  assert.match(staticCacheControl('assets/index-AbC_1234.js'), /immutable/);
  assert.match(staticCacheControl('assets/index-12345678.css'), /immutable/);
});
test('response policy supplies an independent request ID and privacy defaults', () => {
  const headers = {};
  const id = applyHttpPolicy({}, { setHeader: (key, value) => { headers[key] = value; } });
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
});
test('unexpected failures do not disclose internal details', () => {
  assert.equal(publicError(new Error('database credentials'), 'id').body.error.includes('credentials'), false);
  assert.equal(publicError(Object.assign(new Error('Request body too large.'), { statusCode: 413 }), 'id').status, 413);
});
test('explicit input validators retain actionable client errors', () => {
  assert.throws(() => validateInput(() => { throw new Error('Invalid wallet.'); }), error => {
    assert.deepEqual(publicError(error, 'id'), { status: 400, body: { error: 'Invalid wallet.', requestId: 'id' } });
    return true;
  });
});
test('transient RPC rate limits are classified without exposing private endpoint text', () => {
  assert.equal(transientDependencyCode(new Error('HTTP 429 from https://private-rpc/?api-key=secret')),'RPC_RATE_LIMIT');
  assert.equal(transientDependencyCode(new Error('outer',{cause:{response:{status:503},message:'secret'}})),'HTTP_503');
  assert.equal(transientDependencyCode(new Error('Invalid wallet 429')) ,null);
  assert.equal(transientDependencyCode(new Error('database credentials')),null);
});
