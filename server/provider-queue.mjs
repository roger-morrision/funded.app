// A bounded, serial transport lane. The spacing clock advances at actual start,
// so delayed timers cannot release several reserved requests together.
export function retryAfterMs(value, now = Date.now(), fallback = 30_000) {
  if (value == null || value === '') return fallback;
  const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : fallback;
}

export function createProviderQueue({ gapMs, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPending = 40, maxWaitMs = 90_000 } = {}) {
  let tail = Promise.resolve(), pending = 0, nextAt = 0, cooldownUntil = 0;
  const metrics = { calls: 0, fulfilled: 0, failed: 0, rejected: 0, rateLimited: 0, queueDelayMs: 0, maxQueueDelayMs: 0 };
  const delays = [];
  const fail = (message, status = 503) => Object.assign(new Error(message), { status, retryAt: cooldownUntil });
  return {
    cooldown(ms) { cooldownUntil = Math.max(cooldownUntil, now() + ms); },
    stats() { return { ...metrics, pending, cooldownUntil, queueDelayP95Ms: delays.length ? delays.toSorted((a,b)=>a-b)[Math.ceil(delays.length*.95)-1] : 0 }; },
    run(task, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (pending >= maxPending || cooldownUntil > now()) {
        metrics.rejected++;
        return Promise.reject(fail(cooldownUntil > now() ? 'Provider is cooling down.' : 'Provider queue is full.'));
      }
      pending++;
      const queuedAt = now();
      const call = tail.then(async () => {
        signal?.throwIfAborted();
        if (cooldownUntil > now()) throw fail('Provider is cooling down.');
        if (Math.max(now(), nextAt) - queuedAt > maxWaitMs) throw fail('Provider queue deadline exceeded.');
        while (nextAt > now()) { await sleep(nextAt - now()); signal?.throwIfAborted(); }
        if (cooldownUntil > now()) throw fail('Provider is cooling down.');
        const delay = now() - queuedAt;
        delays.push(delay); if (delays.length > 256) delays.shift();
        metrics.queueDelayMs += delay; metrics.maxQueueDelayMs = Math.max(metrics.maxQueueDelayMs, delay);
        nextAt = now() + gapMs;
        metrics.calls++;
        try { const value = await task(); metrics.fulfilled++; return value; }
        catch (error) { metrics.failed++; if (error.status === 429) metrics.rateLimited++; throw error; }
      }).finally(() => { pending--; });
      tail = call.catch(() => {});
      return call;
    },
  };
}
