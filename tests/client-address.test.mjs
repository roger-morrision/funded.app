import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress } from '../server/client-address.mjs';

test('rate-limit address uses the Cloudflare visitor header only behind a trusted proxy', () => {
  const req = { socket: { remoteAddress: '172.21.0.5' }, headers: { 'cf-connecting-ip': '203.0.113.7' } };
  assert.equal(clientAddress(req, { TRUST_PROXY: 'true' }), '203.0.113.7');
  assert.equal(clientAddress(req, {}), '172.21.0.5');
  assert.equal(clientAddress({ socket: { remoteAddress: '172.21.0.5' }, headers: { 'cf-connecting-ip': 'not-an-ip' } }, { TRUST_PROXY: 'true' }), '172.21.0.5');
});
