import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicLaunchBudget } from '../public-launch-budget.js';
import { DEFAULT_SERVICE_FEES } from '../service-fees.js';
import { currentVerifiedLaunchFeeLamports, refreshServiceFees } from '../src/features/fees/service-fees-client.js';
import { initializeLaunchPreview } from '../src/app/startup/launch-preview.js';

const quote = { status: 'ready', solAmountLamports: '8715246', maxSolAmountLamports: '8802399' };

test('public budget reconciles the configured launch fee exactly once in lamports', () => {
  const budget = publicLaunchBudget(quote, '20000000');
  assert.deepEqual(budget, {
    purchase: 8_715_246n,
    allowance: 87_153n,
    overhead: 50_000_000n,
    serviceFee: 20_000_000n,
    total: 78_802_399n,
  });
  assert.equal(publicLaunchBudget(quote, '0').total, 58_802_399n);
  assert.equal(publicLaunchBudget(quote, '35000000').total, 93_802_399n);
});

test('public budget stays unavailable until both quote and policy are valid', () => {
  for (const fee of [undefined, null, '', '-1', '1.5', 'NaN', '9007199254740992']) {
    assert.equal(publicLaunchBudget(quote, fee), null);
  }
  for (const status of ['loading', 'unavailable', 'invalid']) {
    assert.equal(publicLaunchBudget({ ...quote, status }, '20000000'), null);
  }
  assert.equal(publicLaunchBudget({ ...quote, maxSolAmountLamports: '8000000' }, '20000000'), null);
  assert.equal(publicLaunchBudget({ ...quote, maxSolAmountLamports: Number.MAX_SAFE_INTEGER + 1 }, '20000000'), null);
  assert.equal(publicLaunchBudget({ ...quote, solAmountLamports: '-1' }, '20000000'), null);
});

test('verified policy refresh updates the planning fee and failed refresh removes the complete total', async () => {
  const previousWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  let rendered = 0;
  initializeLaunchPreview({ updateCostSummary: () => { rendered += 1; } }, {
    window: events, setInterval: () => {},
  });
  const policyResponse = launchLamports => ({ available: true, data: {
    cluster: 'devnet', hash: 'a'.repeat(64), revision: 2, recipient: 'fee-recipient',
    tradeRecipient: 'trade-recipient', policy: { ...DEFAULT_SERVICE_FEES, launchLamports },
  } });
  try {
    for (const [fee, total] of [['20000000', 78_802_399n], ['35000000', 93_802_399n], ['0', 58_802_399n]]) {
      await refreshServiceFees({ apiRequest: async () => policyResponse(fee) });
      assert.equal(currentVerifiedLaunchFeeLamports(), fee);
      assert.equal(publicLaunchBudget(quote, currentVerifiedLaunchFeeLamports()).total, total);
    }
    assert.equal(rendered, 3);
    let finishOlder;
    const older = refreshServiceFees({ apiRequest: () => new Promise(resolve => { finishOlder = resolve; }) });
    await refreshServiceFees({ apiRequest: async () => policyResponse('30000000') });
    finishOlder(policyResponse('20000000'));
    await older;
    assert.equal(currentVerifiedLaunchFeeLamports(), '30000000');
    assert.equal(rendered, 4);
    await assert.rejects(refreshServiceFees({ apiRequest: async () => ({ available: false }) }), /unavailable/);
    assert.equal(currentVerifiedLaunchFeeLamports(), null);
    assert.equal(publicLaunchBudget(quote, currentVerifiedLaunchFeeLamports()), null);
    assert.equal(rendered, 5);
  } finally {
    globalThis.window = previousWindow;
  }
});
