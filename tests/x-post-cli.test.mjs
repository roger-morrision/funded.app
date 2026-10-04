import test from 'node:test';
import assert from 'node:assert/strict';
import { xWorkerConfig, runXPostCycle } from '../scripts/run-x-post-worker.mjs';

const environment = {
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:15433/funded_x_test',
  X_POST_EXPECTED_HANDLE: '@FundedFixture', X_POST_PUBLIC_ORIGIN: 'https://funded.vip', X_POST_START_AT: '2026-10-01T00:00:00Z',
};
test('CLI defaults to draft and normalizes the explicit target account', () => {
  const config = xWorkerConfig(environment);
  assert.equal(config.execute, false); assert.equal(config.mode, 'once');
  assert.equal(config.handle, 'fundedfixture'); assert.equal(config.cluster, 'devnet');
  assert.equal(config.maxHourlyPosts, 6); assert.equal(config.maxDailyPosts, 24);
  assert.equal(xWorkerConfig(environment, ['--status']).mode, 'status');
});
test('CLI requires independent explicit live gates and a dedicated publication token', () => {
  assert.throws(() => xWorkerConfig(environment, ['--execute']), /X_POST_ENABLED/);
  assert.throws(() => xWorkerConfig({ ...environment, X_POST_ENABLED: 'true' }, ['--execute']), /ALLOW_DEVNET/);
  assert.throws(() => xWorkerConfig({ ...environment, X_POST_ENABLED: 'true', X_POST_ALLOW_DEVNET: 'true' }, ['--execute']), /ACCESS_TOKEN/);
  const enabled = { ...environment, X_POST_ENABLED: 'true', X_POST_ALLOW_DEVNET: 'true', X_POST_ACCESS_TOKEN: 'synthetic-fixture' };
  assert.equal(xWorkerConfig(enabled, ['--execute']).execute, true);
  assert.equal(xWorkerConfig(enabled).execute, false, 'Environment alone must not enable publishing');
});
test('CLI rejects ambiguous modes, wrong networks and unsafe public destinations', () => {
  for (const args of [['--once','--loop'], ['--status','--once'], ['--unknown']]) assert.throws(() => xWorkerConfig(environment, args));
  for (const SOLANA_CLUSTER of ['mainnet-beta', 'testnet', 'mainnet']) assert.throws(() => xWorkerConfig({ ...environment, SOLANA_CLUSTER }), /Devnet/);
  for (const X_POST_PUBLIC_ORIGIN of ['http://funded.vip', 'https://localhost', 'https://127.0.0.1', 'https://funded.vip/other', 'https://secret@funded.vip', 'https://internal.test']) assert.throws(() => xWorkerConfig({ ...environment, X_POST_PUBLIC_ORIGIN }));
  for (const changes of [{X_POST_START_AT:'invalid'}, {X_POST_START_AT:'2999-01-01'}, {X_POST_MAX_HOURLY:'0'}, {X_POST_MAX_DAILY:'1441'}, {X_POST_MIN_PROFIT_LAMPORTS:'1.5'}, {DATABASE_URL:'https://funded.vip'}]) assert.throws(() => xWorkerConfig({ ...environment, ...changes }));
});
test('a queued wrong-network event fails closed before any publication request', async () => {
  let claimed = false, failed = false, sends = 0;
  const store = {
    leaseMs: 60_000, readCursor: async () => ({version:0,cursor:null}), has: async () => false, enqueueBatch: async () => {},
    claim: async () => { if(claimed) return null; claimed=true; return {event:{id:'wrong-network',cluster:'mainnet-beta',text:'Wrong network'},token:'fixture'}; },
    fail: async (id,token,reason) => { assert.equal(id,'wrong-network'); assert.equal(token,'fixture'); assert.equal(reason,'delivery-rejected'); failed=true; },
  };
  const config = {...xWorkerConfig(environment), execute:true};
  const report = await runXPostCycle({ config, store, mainStore:{read:async()=>({})}, readRewards:async()=>null, adapters:{}, publish:async()=>{sends++;}, now:Date.parse('2026-10-04T12:00:00Z') });
  assert.equal(failed,true); assert.equal(sends,0); assert.equal(report.dispatch.failed,1);
});
