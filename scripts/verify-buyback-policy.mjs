import assert from 'node:assert/strict';
import { BUYBACK_POLICY, buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from '../buyback-policy.js';

const policy = buildBuybackPolicy({ fundedMint: 'FUNDEDMint11111111111111111111111111111111' });
assert.equal(policy.source.percentOfFundedRevenue, 5);
assert.equal(policy.source.effectivePercentOfCreatorFees, 1);
assert.equal(policy.burn.instruction, 'BurnChecked');
assert.equal(policy.vault.withdrawalRule, 'no-general-withdrawal-path');

const accrual = buildBuybackAccrual({ claimSignature: 'claim-1', grossCreatorFees: 100, asset: 'SOL', claimedAt: '2026-09-18T00:00:00.000Z' });
assert.equal(accrual.fundedRevenue, 20);
assert.equal(accrual.buybackAmount, 1);

const thresholdAccrual = buildBuybackAccrual({ claimSignature: 'claim-2', grossCreatorFees: 25, asset: 'SOL', claimedAt: '2026-09-18T01:00:00.000Z' });
assert.equal(thresholdAccrual.buybackAmount, 0.25);
const ready = evaluateBuybackBatch({ pendingAmount: 0.25, asset: 'SOL', now: '2026-09-18T02:00:00.000Z', lastExecutionAt: '2026-09-18T01:00:00.000Z', quote: { routeVerified: true, ageSeconds: 2, slippageBps: 50, priceImpactBps: 40, poolLiquidityAmount: 1000 } });
assert.equal(ready.executable, true);
assert.equal(ready.executionAmount, 0.25);

const blocked = evaluateBuybackBatch({ pendingAmount: 1, asset: 'SOL', quote: { routeVerified: true, ageSeconds: 2, slippageBps: 50, priceImpactBps: 80, poolLiquidityAmount: 1000 } });
assert.equal(blocked.executable, false);
assert.equal(blocked.reason, 'price-impact-limit');

const receipt = buildBuybackReceipt({ accrualIds: ['claim-1'], inputAmount: 1, tokensBought: 250, buySignature: 'buy-1', burnSignature: 'burn-1', supplyBefore: 1_000_000, supplyAfter: 999_750, executedAt: '2026-09-18T02:00:00.000Z', mode: 'local-preview' });
const summary = summarizeBuybackLedger([accrual, thresholdAccrual], [receipt]);
assert.equal(summary.pendingByAsset.SOL, 0.25);
assert.equal(summary.burnedTokens, 250);
assert.equal(BUYBACK_POLICY.maximumSlippageBps, 100);

console.log('buyback and burn policy checks passed');
