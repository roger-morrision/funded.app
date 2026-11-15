import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createLiveHub } from '../server/live/hub.mjs';
import { liveTopic, tokenTopicPaths } from '../src/lib/live-topics.js';
import { installLiveData } from '../server/live/install.mjs';

const MINT = 'So11111111111111111111111111111111111111112';

test('only public topic paths are live; token topics need a valid mint', () => {
  assert.equal(liveTopic('/api/market/sol-usd').global, true);
  assert.equal(liveTopic(`/api/tokens/${MINT}/trades`).global, false);
  assert.equal(liveTopic('/api/tokens/not-a-mint/trades'), null);
  assert.equal(liveTopic('/api/rewards/experience?wallet=x'), null);
  assert.equal(tokenTopicPaths(MINT).length, 6);
  assert.deepEqual(tokenTopicPaths('nope'), []);
});

test('hub serves fresh, then stale while refreshing, and pushes only changes', async () => {
  let clock = 1_000_000, calls = 0, body = '{"v":1}';
  const hub = createLiveHub({ now: () => clock, read: async () => { calls++; return { status: 200, body }; } });
  assert.equal(hub.lookup('/api/market/sol-usd'), null);
  const pushes = [];
  const confirmed = [];
  const stop = hub.subscribe('/api/market/sol-usd', (path, snap, { unchanged }) => (unchanged ? confirmed : pushes).push(snap.body));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hub.lookup('/api/market/sol-usd').state, 'fresh');
  clock += 20_000; // past the 15s interval
  assert.equal(hub.lookup('/api/market/sol-usd').state, 'stale');
  await new Promise(resolve => setImmediate(resolve));
  body = '{"v":2}';
  clock += 20_000;
  hub.lookup('/api/market/sol-usd');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pushes, ['{"v":1}', '{"v":2}']);
  assert.deepEqual(confirmed, ['{"v":1}'], 'an unchanged refresh only confirms');
  assert.equal(calls, 3);
  stop();
});

test('failed reads keep the last good snapshot', async () => {
  let fail = false;
  const hub = createLiveHub({ read: async () => fail ? { status: 429, body: '{}' } : { status: 200, body: '{"ok":true}' } });
  hub.subscribe('/api/boosts', () => {});
  await new Promise(resolve => setImmediate(resolve));
  fail = true;
  await hub.boot({ waitMs: 10 });
  assert.equal(hub.snapshot('/api/boosts').body, '{"ok":true}');
});

test('live layer answers boot, cached reads and socket subscriptions', async () => {
  let reads = 0;
  const server = createServer();
  const handle = async (req, res) => {
    reads++;
    res.writeHead(200, { 'content-type': 'application/json', 'x-frame-options': 'DENY' });
    res.end(JSON.stringify({ path: req.url, n: reads }));
  };
  server.on('request', installLiveData({ server, handle, env: { CORS_ORIGIN: 'http://localhost' } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const boot = await fetch(`${base}/api/live/boot`).then(r => r.json());
    assert.equal(boot.entries['/api/market/sol-usd'].body.path, '/api/market/sol-usd');
    const before = reads;
    const cached = await fetch(`${base}/api/market/sol-usd`);
    assert.equal(cached.headers.get('x-live-cache'), 'fresh');
    assert.equal(cached.headers.get('x-frame-options'), 'DENY');
    assert.equal(reads, before, 'cached read does not reach the handler');
    const notModified = await fetch(`${base}/api/market/sol-usd`, { headers: { 'if-none-match': cached.headers.get('etag') } });
    assert.equal(notModified.status, 304);
    const socket = new WebSocket(`${base.replace('http', 'ws')}/api/live`, { origin: 'http://localhost' });
    const first = await new Promise((resolve, reject) => {
      socket.on('open', () => socket.send(JSON.stringify({ op: 'sub', paths: ['/api/market/sol-usd', '/api/x/me'] })));
      socket.on('message', data => resolve(JSON.parse(data.toString())));
      socket.on('error', reject);
    });
    assert.equal(first.op, 'snap');
    assert.equal(first.body.path, '/api/market/sol-usd');
    socket.close();
    const refused = new WebSocket(`${base.replace('http', 'ws')}/api/live`, { origin: 'https://evil.example' });
    await new Promise(resolve => { refused.on('error', resolve); refused.on('close', resolve); });
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});
