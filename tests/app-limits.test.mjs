import test from 'node:test';
import assert from 'node:assert/strict';
import { appLimitsSnapshot, effectiveEnv, handleAdminAppLimits, validateAppLimits } from '../server/app-limits.mjs';
import { withdrawalLimits } from '../server/admin-withdrawal-policy.mjs';
import { adminWriteNeedsEmail } from '../server/admin-email-verification.mjs';

const SOL = 1_000_000_000;
function memoryStore(state = {}) {
  return { state, read: async () => structuredClone(state), update: async fn => fn(state) };
}
async function call(store, method, input) {
  let result;
  const handled = await handleAdminAppLimits({ req:{ method }, res:{}, url:new URL('http://x/api/admin/app-limits'), store,
    body:async () => input, respond:(res, status, value) => { result = { status, value }; }, session:{ wallet:'Admin1' }, env:{} });
  assert.equal(handled, true);
  return result;
}

test('saving app limits is an email-OTP protected admin write', () => {
  assert.equal(adminWriteNeedsEmail('POST', '/api/admin/app-limits'), true);
  assert.equal(adminWriteNeedsEmail('GET', '/api/admin/app-limits'), false);
});

test('admin-saved limits override the environment and are audited', async () => {
  const store = memoryStore();
  const before = await call(store, 'GET');
  assert.equal(before.value.limits.find(row => row.key === 'FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS').source, 'default');
  const saved = await call(store, 'POST', { values:{ FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:3 * SOL }, expectedRevision:0, reason:'Lower the treasury cap for QA' });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.revision, 1);
  assert.equal(store.state.adminAudit['app-limits:1'].wallet, 'Admin1');
  assert.equal(withdrawalLimits(effectiveEnv({ FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:'9' }, store.state)).maxLamports, 3 * SOL);
  const stale = await call(store, 'POST', { values:{ FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:SOL }, expectedRevision:0, reason:'Stale revision attempt' });
  assert.equal(stale.status, 409);
  const reset = await call(store, 'POST', { values:{ FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:null }, expectedRevision:1, reason:'Back to the env value' });
  assert.equal(reset.value.limits.find(row => row.key === 'FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS').source, 'default');
});

test('only known limits within range are accepted', () => {
  assert.throws(() => validateAppLimits({ FUNDED_SIGNER_TOKEN:1 }), /not an admin-editable/);
  assert.throws(() => validateAppLimits({ FUNDED_ADMIN_WITHDRAW_DELAY_SECONDS:-1 }), /out of range/);
  assert.throws(() => validateAppLimits({ FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:1.5 }), /out of range/);
  assert.deepEqual(validateAppLimits({ FUNDED_OUTFLOW_ALERT_LAMPORTS:2 * SOL }), { FUNDED_OUTFLOW_ALERT_LAMPORTS:2 * SOL });
});

test('second-admin approval is off by default; OTP alone authorizes a withdrawal', () => {
  const limits = withdrawalLimits({});
  assert.equal(limits.reviewLamports, Number.MAX_SAFE_INTEGER);
  const row = appLimitsSnapshot({}, {}).limits.find(item => item.key === 'FUNDED_ADMIN_WITHDRAW_REVIEW_LAMPORTS');
  assert.equal(row.optional, true);
});
