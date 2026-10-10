import test from 'node:test';
import assert from 'node:assert/strict';
import { launchEstimateRetry, shouldAutoRefreshLaunchEstimate, launchEstimateRefreshMessage } from '../src/features/launch/estimate-refresh.js';
import { initializeLaunchPreview } from '../src/app/startup/launch-preview.js';
import { createWalletMetricsController } from '../src/app/controllers/wallet-metrics.js';

test('transient failures use bounded backoff and honor server retry-after', () => {
  let retry;
  for (const delay of [15000, 30000, 60000, 120000, 120000]) {
    retry = launchEstimateRetry(new Error('429 Too many requests'), retry, 1000);
    assert.equal(retry.nextAt, 1000 + delay);
  }
  assert.equal(launchEstimateRetry({ message: '503', response: { headers: { get: () => '180' } } }, {}, 0).nextAt, 180000);
  for (const message of ['Failed to fetch', 'Network request failed', 'BlockhashNotFound', 'Estimate took too long and expired.'])
    assert.equal(launchEstimateRetry(new Error(message)).retryable, true);
  for (const message of ['Developer buy cannot exceed 20% of supply', 'Insufficient SOL', 'Creator shares must total 80%', 'Fee-router policy is not verified'])
    assert.equal(launchEstimateRetry(new Error(message)).retryable, false);
});

test('automatic refresh pauses for inactive pages, offline state, review, signing and requests already running', () => {
  const ready = { active: true, visible: true, online: true, wallet: {}, validForm: true };
  assert.equal(shouldAutoRefreshLaunchEstimate(ready), true);
  for (const override of [{ active: false }, { visible: false }, { online: false }, { wallet: null }, { loading: true }, { reviewing: {} }, { submitting: true }, { validForm: false }])
    assert.equal(shouldAutoRefreshLaunchEstimate({ ...ready, ...override }), false);
  assert.equal(shouldAutoRefreshLaunchEstimate({ ...ready, error: 'invalid input' }), false);
  assert.equal(shouldAutoRefreshLaunchEstimate({ ...ready, error: '429', retry: { retryable: true, nextAt: 15000 } }, 14999), false);
  assert.equal(shouldAutoRefreshLaunchEstimate({ ...ready, error: '429', retry: { retryable: true, nextAt: 15000 } }, 15000), true);
  assert.match(launchEstimateRefreshMessage({ wallet: {}, retry: { retryable: true, nextAt: 15000 } }, 5000), /automatically in 10s/);
});

test('startup retries a failed null estimate, avoids duplicates, and refreshes again before quote expiry', t => {
  let now = 1000, tick, requests = 0;
  t.mock.method(Date, 'now', () => now);
  const state = { wallet: {}, launchCostReview: null, walletEstimateError: '429', launchEstimateRetry: launchEstimateRetry('429', {}, now),
    requestedPageRoute: () => 'launch', getLaunchStepState: () => ({ valid: true }),
    refreshQuoteClocks() {}, renderPendingLaunchReview() {}, updateCostSummary() {},
    scheduleLaunchCostRefresh() { requests++; state.walletMetricsLoading = true; } };
  const document = { hidden: false };
  initializeLaunchPreview(state, { document, navigator: { onLine: true }, setInterval: fn => { tick = fn; } });
  tick(); assert.equal(requests, 0);
  now = 16000; tick(); tick(); assert.equal(requests, 1);
  state.walletMetricsLoading = false; state.walletEstimateError = ''; state.launchEstimateRetry = null;
  state.launchCostReview = { quotedAt: now, expiresAt: now + 60000 };
  tick(); assert.equal(requests, 1);
  now += 55000; document.hidden = true; tick(); assert.equal(requests, 1);
  document.hidden = false; tick(); assert.equal(requests, 2);
});

test('RPC failure records an auto retry without extra RPC calls or rapid manual retries', async t => {
  t.mock.method(console, 'warn', () => {});
  let rpcCalls = 0;
  const state = { wallet: {}, metricsRequest: 0, walletBalanceLamports: 1,
    captureWalletSession: () => ({ address: 'test-wallet', provider: { publicKey: {} } }), isWalletSessionCurrent: () => true,
    getSolana: async () => { rpcCalls++; throw new Error('429 rate limited'); }, developerBuyLimitReached: () => false,
    getLaunchBurnPolicy: () => ({ requiresBurn: false }),
    setWalletMetrics({ loading = false, error = '' } = {}) { state.walletMetricsLoading = loading; state.walletEstimateError = error; } };
  const controller = createWalletMetricsController(state);
  await controller.refreshWalletInfo();
  assert.equal(state.launchEstimateRetry.retryable, true);
  assert.equal(state.walletMetricsLoading, false);
  assert.equal(state.walletEstimateError, 'Solana RPC is rate limited.');
  await controller.refreshWalletInfo();
  assert.equal(rpcCalls, 1);
});

test('an old wallet failure cannot schedule retries for a different session', async t => {
  t.mock.method(console, 'warn', () => {});
  let reject, current = true;
  const state = { wallet: {}, metricsRequest: 0,
    captureWalletSession: () => ({ address: 'old-wallet', provider: { publicKey: {} } }), isWalletSessionCurrent: () => current,
    getSolana: () => new Promise((_, fail) => { reject = fail; }), setWalletMetrics() {} };
  const promise = createWalletMetricsController(state).refreshWalletInfo();
  current = false; reject(new Error('429')); await promise;
  assert.equal(state.launchEstimateRetry, null);
});
