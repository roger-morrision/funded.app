import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutePoller } from '../route-polling.js';
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture(t, run, active = () => true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = new EventTarget(); document.hidden = false;
  const window = new EventTarget();
  const poller = createRoutePoller({ document, window, active, run, intervalMs: 100 });
  t.after(() => poller.stop());
  return { document, window, poller };
}
test('hidden page cancels work, resume waits for old work and immediately refreshes', async t => {
  let complete, calls = 0, signal;
  const { document } = fixture(t, s => { calls++; signal = s; return new Promise(resolve => { complete = resolve; }); });
  t.mock.timers.tick(100); assert.equal(calls, 1);
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(signal.aborted, true);
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(1000); assert.equal(calls, 1);
  complete(); await flush(); t.mock.timers.tick(0); assert.equal(calls, 2);
  complete(); await flush();
});
test('pagehide suspends polling until pageshow, including the old request finally handler', async t => {
  let calls = 0, complete;
  const { window } = fixture(t, () => { calls++; return new Promise(resolve => { complete = resolve; }); });
  t.mock.timers.tick(100); window.dispatchEvent(new Event('pagehide'));
  complete(); await flush(); t.mock.timers.tick(1000); assert.equal(calls, 1);
  window.dispatchEvent(new Event('pageshow')); t.mock.timers.tick(0); assert.equal(calls, 2);
  complete(); await flush();
});
test('route events cancel inactive polling and backoff eligibility recovers without navigation', async t => {
  let active = false, calls = 0;
  const { window } = fixture(t, async () => { calls++; }, () => active);
  t.mock.timers.tick(100); assert.equal(calls, 0);
  active = true; t.mock.timers.tick(100); await flush(); assert.equal(calls, 1);
  active = false; window.dispatchEvent(new Event('funded:route-change'));
  t.mock.timers.tick(100); assert.equal(calls, 1);
});
test('failures back off and stopping prevents restarts from route events', async t => {
  let calls = 0;
  const { window, poller } = fixture(t, async () => { calls++; throw new Error('offline'); });
  t.mock.timers.tick(100); await flush();
  t.mock.timers.tick(199); assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
  poller.stop(); window.dispatchEvent(new Event('funded:route-change'));
  t.mock.timers.tick(1000); assert.equal(calls, 2);
});
