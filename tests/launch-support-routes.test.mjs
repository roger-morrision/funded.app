import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchSupportRoutes } from '../server/routes/launch-support.mjs';

function fixture() {
  const state = { launchReviews: {}, alerts: {}, xIntake: {} };
  let writes = 0;
  const handlers = createLaunchSupportRoutes({
    store: { update: async change => { writes++; return change(state); } },
    body: async req => req.input, id: prefix => `${prefix}-fixture`,
    respond: (res, status, data) => { res.status = status; res.data = data; res.responses++; },
  });
  return { state, writes: () => writes, async request(path, input = {}, method = 'POST') {
    const res = { responses: 0 };
    const req = { method, input }, url = new URL(path, 'https://funded.vip');
    res.handled = await handlers.handleLaunchPreview(req, res, url)
      || await handlers.handleLaunchSupport(req, res, url);
    return res;
  } };
}

test('launch support leaves unrelated routes and methods untouched', async () => {
  const app = fixture();
  for (const [path, method] of [['/unknown', 'POST'], ['/api/launch-reviews', 'GET'], ['/api/rewards/preview', 'GET']]) {
    const res = await app.request(path, {}, method);
    assert.equal(res.handled, false);
    assert.equal(res.responses, 0);
  }
  assert.equal(app.writes(), 0);
});

test('reward preview rejects unsupported configurations without persisting anything', async () => {
  const app = fixture();
  const res = await app.request('/api/rewards/preview', { transferFeeBps: 999 });
  assert.equal(res.status, 400);
  assert.equal(res.data.config.valid, false);
  assert.equal(res.responses, 1);
  assert.equal(app.writes(), 0);
});

test('launch review requires identity and preserves the first saved snapshot', async () => {
  const app = fixture();
  assert.equal((await app.request('/api/launch-reviews', { mint: 'mint' })).status, 400);
  assert.equal(app.writes(), 0);
  const first = await app.request('/api/launch-reviews', { mint: 'mint', creatorWallet: 'creator', name: 'Original' });
  const second = await app.request('/api/launch-reviews', { mint: 'mint', creatorWallet: 'other', name: 'Replacement' });
  assert.equal(first.status, 201);
  assert.match(first.data.reviewHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(second.data, first.data);
  assert.equal(app.state.launchReviews.mint.creatorWallet, 'creator');
});

test('alerts and X launch requests retain validation and persisted record fields', async () => {
  const app = fixture();
  assert.equal((await app.request('/api/alerts', { wallet: 'viewer', mint: 'mint', type: 'unknown' })).status, 400);
  assert.equal(app.writes(), 0);
  const alert = await app.request('/api/alerts', { wallet: ' viewer ', mint: 'mint', type: 'volume-spike', threshold: '12' });
  assert.equal(alert.status, 201);
  assert.equal(alert.data.wallet, 'viewer');
  assert.equal(alert.data.threshold, 12);
  assert.equal(app.state.alerts[alert.data.id].status, 'active');
  await assert.rejects(app.request('/api/x-intake', { handle: 'not a handle', request: 'Launch' }), { statusCode: 400 });
  const intake = await app.request('/api/x-intake', { handle: 'funded', request: ' Launch a token ' });
  assert.equal(intake.status, 201);
  assert.equal(intake.data.handle, '@funded');
  assert.equal(app.state.xIntake[intake.data.id].request, 'Launch a token');
  assert.equal(intake.data.status, 'queued-for-review');
});
