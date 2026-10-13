import test from 'node:test';
import assert from 'node:assert/strict';
import { createV3Routes } from '../server/routes/v3-routes.mjs';

test('retired V2 fee writes cannot reach their old handlers', async () => {
  const responses = [];
  const handle = createV3Routes({ respond:(_res, status, body) => responses.push({ status, body }) });
  const paths = [
    '/api/settlements/claims', '/api/payout-obligations/sol', '/api/x-fee/obligations',
    '/api/sol-claims/claim/prepare', '/api/sol-claims/claim/verify',
    '/api/sol-claims/claim/attest', '/api/sol-claims/claim/execute',
    '/api/referral-claims/prepare', '/api/referral-claims/claim/verify',
    '/api/referral-claims/claim/execute', '/api/keeper/reconcile-wrapped-sol',
    '/api/tokens/mint/creator-claim/prepare', '/api/tokens/mint/creator-claim/request',
    '/api/tokens/mint/creator-claim/settle', '/api/tokens/mint/reward-funding/settle',
  ];
  for (const path of paths)
    assert.equal(await handle({ method:'POST' }, {}, new URL(path, 'http://localhost')), true);
  assert.equal(await handle({ method:'GET' }, {}, new URL('/api/tokens/mint/reward-funding/pending', 'http://localhost')), true);
  assert.equal(responses.length, paths.length + 1);
  assert.equal(responses.every(row => row.status === 410 && /V2 fee route is retired/.test(row.body.error)), true);
});

test('V3 routes remain available to their own handlers', async () => {
  const handle = createV3Routes({ respond:() => assert.fail('unmatched route must not respond') });
  assert.equal(await handle({ method:'GET' }, {}, new URL('/api/tokens/mint/v3-settlement', 'http://localhost')), false);
});
