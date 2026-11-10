import test from 'node:test';
import assert from 'node:assert/strict';
import { retryUnavailableReadiness, readinessRejection } from '../server/v3-launch-readiness.mjs';

test('readiness retries one RPC failure and then succeeds', async () => {
  const results = [{ ready: false, status: 503 }, { ready: true }];
  let calls = 0;
  const result = await retryUnavailableReadiness(async () => results[calls++], { delayMs: 0 });
  assert.equal(result.ready, true);
  assert.equal(calls, 2);
});

test('policy mismatches are not retried and stay 409', async () => {
  let calls = 0;
  const result = await retryUnavailableReadiness(async () => { calls++; return { ready: false, status: 409 }; }, { delayMs: 0 });
  assert.equal(calls, 1);
  assert.equal(readinessRejection(result).status, 409);
});

test('persistent RPC failure is reported as a retryable 503', async () => {
  const result = await retryUnavailableReadiness(async () => ({ ready: false, status: 503 }), { delayMs: 0 });
  assert.deepEqual(readinessRejection(result), { status: 503, error: 'Solana RPC could not verify the V3 program right now. Retry shortly.' });
  assert.equal(readinessRejection({ ready: true }).status, 409);
});
