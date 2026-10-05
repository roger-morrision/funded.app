import assert from 'node:assert/strict';
import test from 'node:test';
import { LAUNCH_TIER_USD, launchTierAmounts, launchTierQuoteCurrent } from '../launch-tier-quote.js';
import { launchReviewStillCurrent } from '../launch-review-gate.js';

test('Pro and Premier burn counts cover their USD targets at a positive pool price', () => {
  const price = 0.008116173245088697;
  const amounts = launchTierAmounts(price);
  assert.deepEqual(amounts, { pro: 12322, premier: 24643 });
  for (const [tier, usd] of Object.entries(LAUNCH_TIER_USD)) {
    assert.ok(amounts[tier] * price >= usd);
    assert.ok((amounts[tier] - 1) * price < usd);
  }
  assert.throws(() => launchTierAmounts(0));
  assert.throws(() => launchTierAmounts(Number.POSITIVE_INFINITY));
});

test('paid launch quote is bound to tier, wallet, mint, and expiry', () => {
  const now = Date.UTC(2026, 9, 5);
  const quote = { id:'launch_tier_1_0123456789abcdef', tier:'pro', payer:'wallet-a', fundedMint:'mint-a',
    amountTokens:12322, usd:100, createdAt:new Date(now - 1000).toISOString(), expiresAt:new Date(now + 60000).toISOString() };
  const matches = { tier:'pro', payer:'wallet-a', mint:'mint-a', now };
  assert.equal(launchTierQuoteCurrent(quote, matches), true);
  assert.equal(launchTierQuoteCurrent(quote, { ...matches, payer:'wallet-b' }), false);
  assert.equal(launchTierQuoteCurrent(quote, { ...matches, now:now + 60000 }), false);
});

test('review invalidates when the locked burn quote or amount changes', () => {
  const now = Date.UTC(2026, 9, 5);
  const shared = { reviewedCost:{ quotedAt:now - 1000, expiresAt:now + 60000 }, wallet:'wallet-a', router:'router-a', form:'{}', image:null,
    feeConsent:true, termsConsent:true, tierQuoteId:'quote-a', tierBurnAmount:12322 };
  assert.equal(launchReviewStillCurrent(shared, shared, now), true);
  assert.equal(launchReviewStillCurrent(shared, { ...shared, tierQuoteId:'quote-b' }, now), false);
  assert.equal(launchReviewStillCurrent(shared, { ...shared, tierBurnAmount:12323 }, now), false);
});
