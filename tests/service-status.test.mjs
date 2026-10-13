import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceStatus, GENESIS_HASHES } from '../server/service-status.mjs';

test('operational dependencies do not certify settlement or authorize mainnet', async () => {
  const result = await serviceStatus({ cluster: 'devnet', build: 'test', database: async () => true, rpc: async () => GENESIS_HASHES.devnet });
  assert.equal(result.status, 'operational');
  assert.equal(result.settlementVerified, false);
  assert.equal(result.mainnetActivationAuthorized, false);
});
test('finalized V3 evidence certifies settlement while mainnet stays unauthorized', async () => {
  const result = await serviceStatus({ cluster:'devnet', build:'test',
    database:async () => true, rpc:async () => GENESIS_HASHES.devnet,
    settlement:async () => ({ verified:true, scope:'all-recorded-v3-collections',
      recorded:4, checked:4 }) });
  assert.equal(result.status, 'operational');
  assert.equal(result.settlementVerified, true);
  assert.equal(result.settlementEvidence.checked, 4);
  assert.equal(result.mainnetActivationAuthorized, false);
});
test('settlement proof failures and timeouts fail closed without leaking internals', async () => {
  for (const settlement of [async () => { throw new Error('secret-rpc-url'); },
    () => new Promise(() => {})]) {
    const result = await serviceStatus({ cluster:'devnet', database:async () => true,
      rpc:async () => GENESIS_HASHES.devnet, settlement, settlementTimeoutMs:10 });
    assert.equal(result.status, 'operational');
    assert.equal(result.settlementVerified, false);
    assert.equal(JSON.stringify(result).includes('secret-rpc-url'), false);
  }
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
