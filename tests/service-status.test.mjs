import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceStatus, GENESIS_HASHES } from '../server/service-status.mjs';

test('operational dependencies do not certify settlement or authorize mainnet', async () => {
  const result = await serviceStatus({ cluster: 'devnet', build: 'test', database: async () => true, rpc: async () => GENESIS_HASHES.devnet });
  assert.equal(result.status, 'operational');
  assert.equal(result.settlementVerified, false);
  assert.equal(result.mainnetActivationAuthorized, false);
});
test('wrong cluster and dependency failures are explicit and do not expose internals', async () => {
  const result = await serviceStatus({ cluster: 'devnet', database: async () => { throw new Error('secret-url'); }, rpc: async () => GENESIS_HASHES['mainnet-beta'] });
  assert.equal(result.status, 'degraded');
  assert.equal(result.checks[1].status, 'wrong-network');
  assert.equal(JSON.stringify(result).includes('secret-url'), false);
});
test('synchronous failures and stalled dependencies complete with degraded status', async () => {
  const result = await serviceStatus({ cluster: 'devnet', database: () => { throw new Error('private-url'); }, rpc: () => new Promise(() => {}), timeoutMs: 10 });
  assert.equal(result.status, 'degraded');
  assert.ok(result.checks.every(check => check.status === 'unavailable'));
  assert.equal(JSON.stringify(result).includes('private-url'), false);
});
