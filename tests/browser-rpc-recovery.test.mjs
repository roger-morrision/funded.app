import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcReadScheduler } from '../src/features/shared/rpc-read-scheduler.js';
import { createConnectionsController } from '../src/app/controllers/connections.js';
import { SOLANA_GENESIS } from '../solana-network.js';
import { Connection } from '@solana/web3.js';

const primary = 'https://richpad.fun/api/solana/rpc';
const payload = (method = 'getLatestBlockhash') => ({ method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: [] }) });
const json = result => Response.json({ jsonrpc: '2.0', id: 7, result });
const gateway = () => new Response('<html><title>Cloudflare 502 secret upstream details</title></html>', { status: 502 });

test('blockhash read recovers after a gateway interruption without exposing HTML', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ fetch: async () => ++calls === 1 ? gateway() : json({ blockhash: 'fresh' }) });
  assert.deepEqual((await (await fetch(primary, payload())).json()).result, { blockhash: 'fresh' });
  assert.equal(calls, 2);
});

test('public fallback verifies the selected network and strips app credentials', async () => {
  const calls = [];
  const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === primary) return gateway();
    return json(JSON.parse(init.body).method === 'getGenesisHash' ? SOLANA_GENESIS.devnet : 520329139);
  } });
  const request = { ...payload('getSlot'), headers: { Authorization: 'private-app-token' }, credentials: 'include' };
  assert.equal((await (await fetch(primary, request)).json()).result, 520329139);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(2).map(c => JSON.parse(c.init.body).method), ['getGenesisHash', 'getSlot']);
  for (const call of calls.slice(2)) {
    assert.equal(call.url, 'https://api.devnet.solana.com');
    assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json' });
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.referrerPolicy, 'no-referrer');
  }
  assert.equal(calls.at(-1).init.body, request.body);
});

test('wrong-cluster public fallback never receives the application read', async () => {
  const publicMethods = [];
  const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async (url, init) => {
    if (url === primary) return gateway();
    publicMethods.push(JSON.parse(init.body).method);
    return json(SOLANA_GENESIS['mainnet-beta']);
  } });
  await assert.rejects(fetch(primary, payload()), /network verification failed/);
  assert.deepEqual(publicMethods, ['getGenesisHash']);
});

test('unavailable endpoints yield a concise error with a bounded number of requests', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async () => { calls++; return gateway(); } });
  await assert.rejects(fetch(primary, payload()), error => {
    assert.match(error.message, /HTTP 502/);
    assert.doesNotMatch(error.message, /html|secret|Cloudflare/);
    return true;
  });
  assert.equal(calls, 3);
});

test('writes, simulations, faucet, unknown methods and mixed batches are never replayed', async () => {
  const requests = ['sendTransaction', 'simulateTransaction', 'requestAirdrop', 'unknown'].map(payload);
  requests.push({ ...payload(), body: JSON.stringify([JSON.parse(payload().body), JSON.parse(payload('sendTransaction').body)]) });
  for (const request of requests) {
    let calls = 0;
    const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async () => { calls++; return gateway(); } });
    await assert.rejects(fetch(primary, request), /HTTP 502/);
    assert.equal(calls, 1);
  }
});

test('authentication failures do not trigger retries or bypass via public RPC', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async () => { calls++; return new Response('private reason', { status: 403 }); } });
  await assert.rejects(fetch(primary, payload()), /HTTP 403/);
  assert.equal(calls, 1);
});

test('RPC execution errors retain their exact JSON and are not retried', async () => {
  let calls = 0;
  const body = { jsonrpc: '2.0', id: 7, error: { code: -32002, message: 'Simulation failed' } };
  const fetch = createRpcReadScheduler({ fetch: async () => { calls++; return Response.json(body); } });
  assert.deepEqual(await (await fetch(primary, payload('sendTransaction'))).json(), body);
  assert.equal(calls, 1);
});

test('malformed HTTP 200 response is recovered but never displayed as HTML', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ fetch: async () => ++calls === 1 ? new Response('<html>bad gateway</html>') : json(42) });
  assert.equal((await (await fetch(primary, payload('getSlot'))).json()).result, 42);
  assert.equal(calls, 2);
});

test('caller cancellation prevents retry and fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  const reason = new Error('user left page');
  const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async () => { calls++; controller.abort(reason); throw reason; } });
  await assert.rejects(fetch(primary, { ...payload(), signal: controller.signal }), error => error === reason);
  assert.equal(calls, 1);
});

test('timeouts are bounded and release the scheduler slot for subsequent reads', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ maxActive: 1, timeoutMs: 10, fetch: async (_url, init) => {
    calls++;
    if (calls > 2) return json(42);
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } });
  const failed = assert.rejects(fetch(primary, payload()), /connection was interrupted/);
  const next = fetch(primary, payload('getSlot'));
  await failed;
  assert.equal((await (await next).json()).result, 42);
  assert.equal(calls, 3);
});

test('read recovery stays inside the shared concurrency limit', async () => {
  let active = 0, maximum = 0;
  const attempts = new Map();
  const fetch = createRpcReadScheduler({ maxActive: 2, fetch: async (_url, init) => {
    const id = JSON.parse(init.body).id;
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--; attempts.set(id, (attempts.get(id) || 0) + 1);
    return attempts.get(id) === 1 ? gateway() : json(id);
  } });
  await Promise.all(Array.from({ length: 8 }, (_, id) => fetch(primary, { ...payload(), body: JSON.stringify({ id, method: 'getSlot' }) })));
  assert.equal(maximum, 2);
  assert([...attempts.values()].every(count => count === 2));
});

test('connections share the read budget only within the same selected cluster', () => {
  const controller = createConnectionsController({ APP_CLUSTER: 'devnet' });
  const devnet = controller.connectionConfig({}).fetch;
  assert.equal(devnet, controller.connectionConfig({}, 'devnet').fetch);
  assert.notEqual(devnet, controller.connectionConfig({}, 'mainnet-beta').fetch);
});

test('Solana SDK blockhash lookup survives the reported Cloudflare response', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ fetch: async (_url, init) => {
    if (++calls === 1) return gateway();
    return Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id,
      result: { context: { slot: 520329139 }, value: { blockhash: 'fresh-blockhash', lastValidBlockHeight: 507472000 } } });
  } });
  const connection = new Connection(primary, { fetch, disableRetryOnRateLimit: true });
  assert.deepEqual(await connection.getLatestBlockhash('confirmed'), { blockhash: 'fresh-blockhash', lastValidBlockHeight: 507472000 });
  assert.equal(calls, 2);
});

test('Solana SDK transaction submission warns about receipt checking without replay', async () => {
  let calls = 0;
  const fetch = createRpcReadScheduler({ cluster: 'devnet', fetch: async () => { calls++; return gateway(); } });
  const connection = new Connection(primary, { fetch, disableRetryOnRateLimit: true });
  await assert.rejects(connection.sendRawTransaction(new Uint8Array([1, 2, 3])), /check its receipt before retrying/);
  assert.equal(calls, 1);
});
