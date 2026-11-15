import { createHash } from 'node:crypto';
import { GLOBAL_TOPICS, liveTopic } from '../../src/lib/live-topics.js';

// Live data hub: keeps public API responses warm in a snapshot cache.
// - A topic refreshes on its interval only while it has demand (a socket
//   subscriber, or an HTTP read in the last two minutes), so an idle site
//   makes no upstream calls.
// - HTTP reads are answered from the snapshot (stale-while-revalidate), so a
//   page never waits for an upstream provider that is slow or rate-limited.
// - Changed snapshots are pushed to subscribed sockets.
// `read(path)` performs the real request (the app's own handler over loopback).
export function createLiveHub({ read, now = Date.now, demandWindowMs = 120_000, tickMs = 1_000, maxTokenTopics = 300 } = {}) {
  const snapshots = new Map(); // path -> { body, etag, at, status }
  const topics = new Map();    // path -> { topic, subscribers:Set, demandAt, refreshing:Promise|null, failures }
  let timer = null;

  const entry = path => {
    let row = topics.get(path);
    if (!row) {
      const topic = liveTopic(path);
      if (!topic) return null;
      if (!topic.global && [...topics.values()].filter(item => !item.topic.global).length >= maxTokenTopics) return null;
      row = { topic, subscribers: new Set(), demandAt: 0, refreshing: null, failures: 0 };
      topics.set(path, row);
    }
    return row;
  };

  async function refresh(path) {
    const row = entry(path);
    if (!row) return null;
    if (row.refreshing) return row.refreshing;
    row.refreshing = (async () => {
      try {
        const { status, body } = await read(path);
        if (status !== 200 || typeof body !== 'string') throw Object.assign(new Error(`status ${status}`), { status });
        const etag = createHash('sha1').update(body).digest('base64url').slice(0, 16);
        const previous = snapshots.get(path);
        snapshots.set(path, { body, etag, at: now(), status });
        row.failures = 0;
        if (previous?.etag !== etag) for (const listener of row.subscribers) { try { listener(path, snapshots.get(path)); } catch {} }
        return snapshots.get(path);
      } catch {
        row.failures = Math.min(row.failures + 1, 6);
        return snapshots.get(path) || null;
      } finally { row.refreshing = null; }
    })();
    return row.refreshing;
  }

  // Failing topics back off (2x interval per failure, up to 64x) instead of retrying every tick.
  const due = (path, row) => {
    const snap = snapshots.get(path);
    const wait = row.topic.intervalMs * 2 ** row.failures;
    return !snap || now() - snap.at >= wait;
  };
  const wanted = row => row.subscribers.size > 0 || now() - row.demandAt < demandWindowMs;

  function tick() {
    for (const [path, row] of topics) {
      if (!wanted(row)) { if (!row.topic.global && !row.subscribers.size) { topics.delete(path); snapshots.delete(path); } continue; }
      if (!row.refreshing && due(path, row)) void refresh(path);
    }
  }

  return {
    start() { if (!timer) { timer = setInterval(tick, tickMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    // Snapshot for an HTTP read: fresh within the interval, or stale (up to 4x) while a refresh runs.
    lookup(path) {
      const row = entry(path);
      if (!row) return null;
      row.demandAt = now();
      const snap = snapshots.get(path);
      if (!snap) return null;
      const age = now() - snap.at;
      if (age < row.topic.intervalMs) return { ...snap, state: 'fresh' };
      if (age < row.topic.intervalMs * 4) { if (!row.refreshing) void refresh(path); return { ...snap, state: 'stale' }; }
      return null;
    },
    // A handler response for a topic path (cache miss) seeds the snapshot.
    remember(path, body) {
      const row = entry(path);
      if (!row || typeof body !== 'string') return;
      row.demandAt = now();
      snapshots.set(path, { body, etag: createHash('sha1').update(body).digest('base64url').slice(0, 16), at: now(), status: 200 });
    },
    subscribe(path, listener) {
      const row = entry(path);
      if (!row) return null;
      row.subscribers.add(listener);
      row.demandAt = now();
      const snap = snapshots.get(path);
      if (!snap || now() - snap.at >= row.topic.intervalMs) void refresh(path);
      return () => { row.subscribers.delete(listener); row.demandAt = now(); };
    },
    snapshot: path => snapshots.get(path) || null,
    intervalOf: path => liveTopic(path)?.intervalMs ?? null,
    // Startup snapshot of the shared reads: waits briefly for cold topics, then returns what is ready.
    async boot({ waitMs = 1_500 } = {}) {
      const paths = GLOBAL_TOPICS.filter(topic => topic.boot !== false).map(topic => topic.path);
      for (const path of paths) { const row = entry(path); if (row) row.demandAt = now(); }
      const cold = paths.filter(path => !snapshots.get(path) || now() - snapshots.get(path).at >= liveTopic(path).intervalMs * 4);
      if (cold.length) await Promise.race([Promise.allSettled(cold.map(refresh)), new Promise(done => setTimeout(done, waitMs))]);
      const entries = {};
      for (const path of paths) {
        const snap = snapshots.get(path);
        if (snap && now() - snap.at < liveTopic(path).intervalMs * 4) entries[path] = { at: snap.at, maxAgeMs: liveTopic(path).intervalMs * 2, body: snap.body };
      }
      return { serverTime: now(), entries };
    },
    stats: () => ({ topics: topics.size, snapshots: snapshots.size, subscribed: [...topics.values()].filter(row => row.subscribers.size).length }),
  };
}
