import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairLaunchRoutes, pairLaunchEnabled } from '../server/routes/pair-launch.mjs';

test('paired launches open on Devnet, and on Mainnet only with the flag and durable metadata', () => {
  assert.equal(pairLaunchEnabled({ solanaCluster: 'devnet', env: {} }), true);
  assert.equal(pairLaunchEnabled({ solanaCluster: 'mainnet-beta', env: {} }), false);
  assert.equal(pairLaunchEnabled({ solanaCluster: 'mainnet-beta', env: { PAIR_LAUNCH_MAINNET: 'true' } }), false);
  assert.equal(pairLaunchEnabled({ solanaCluster: 'mainnet-beta', env: { PAIR_LAUNCH_MAINNET: 'true', METADATA_STORAGE: 'pinata' } }), true);
});

test('the record route refuses closed networks and malformed input before any RPC read', async () => {
  const calls = [];
  const make = (solanaCluster, env = {}) => createPairLaunchRoutes({ solanaCluster, solanaRpcUrl: 'http://x', env, store: { update: async () => { calls.push('store'); } },
    pairQuotes: { read: async () => ({ quotes: [] }) }, body: async req => req.body, respond: (res, status, body) => Object.assign(res, { status, body }),
    connectionFactory: () => { calls.push('rpc'); throw new Error('no rpc in tests'); } });
  const send = async (route, body) => { const res = {}; await route({ method: 'POST', body }, res, new URL('http://x/api/pair-launch/record')); return res; };
  assert.equal((await send(make('mainnet-beta'), { mint: 'x', signature: 'y' })).status, 403);
  assert.equal((await send(make('devnet'), { mint: 'not-a-mint', signature: 'y' })).status, 400);
  const status = {}; await make('mainnet-beta')({ method: 'GET' }, status, new URL('http://x/api/pair-launch/status'));
  assert.deepEqual(status.body, { cluster: 'mainnet-beta', enabled: false });
  assert.deepEqual(calls, []);
});
