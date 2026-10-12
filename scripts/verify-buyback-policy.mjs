import { readAppSourceSync } from './read-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUYBACK_POLICY, buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from '../buyback-policy.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

const appSource = ['../app.js', '../src/features/funded/buyback-view.js']
  .map(path => path === '../app.js' ? readAppSourceSync() : readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrapSource = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const receiptEmptyState = 'No confirmed $FUNDED burns yet. Fee-funded buybacks and launch promotions appear here separately.';
assert.ok(appSource.includes(receiptEmptyState), 'rendered buyback ledger explains missing on-chain receipts');
assert.ok(htmlSource.includes(receiptEmptyState), 'initial buyback ledger explains missing on-chain receipts');
assert.doesNotMatch(bootstrapSource, /import\(['"]\.\/data-label-sanitizer\.js['"]\)/, 'the UI must not hide verification and empty-state explanations');
const previewRendererSource = appSource.match(/function renderBuybackExample\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(previewRendererSource, 'buyback input has a local-only preview renderer');
const input = { value: '10', parentElement: { querySelector: () => help } };
const help = { textContent: '' };
const renderExample = new Function('document', 'formatBuybackAmount', 'FEE_DISTRIBUTION', `${previewRendererSource}; return renderBuybackExample;`)(
  { querySelector: () => input },
  value => String(value),
  { buybackEffectivePercent: BUYBACK_POLICY.effectivePercentOfCreatorFees },
);
renderExample();
assert.ok(help.textContent.includes(`${10 * BUYBACK_POLICY.effectivePercentOfCreatorFees / 100} SOL (${BUYBACK_POLICY.effectivePercentOfCreatorFees}%)`));
assert.match(help.textContent, /Local calculation only/);
input.value = '0';
renderExample();
assert.match(help.textContent, /above zero/);

const policy = buildBuybackPolicy({ fundedMint: 'FUNDEDMint11111111111111111111111111111111' });
assert.equal(policy.source.percentOfFundedRevenue, PROTOCOL_FEE_SPLIT.buybackPercent);
assert.equal(policy.source.effectivePercentOfCreatorFees, PROTOCOL_FEE_SPLIT.buybackPercent / 5);
assert.equal(policy.burn.instruction, 'BurnChecked');
assert.equal(policy.vault.withdrawalRule, 'no-general-withdrawal-path');

const accrual = buildBuybackAccrual({ claimSignature: 'claim-1', grossCreatorFees: 100, asset: 'SOL', claimedAt: '2026-09-18T00:00:00.000Z' });
assert.equal(accrual.fundedRevenue, 20);
assert.equal(accrual.buybackAmount, BUYBACK_POLICY.effectivePercentOfCreatorFees);

const thresholdAccrual = buildBuybackAccrual({ claimSignature: 'claim-2', grossCreatorFees: 5, asset: 'SOL', claimedAt: '2026-09-18T01:00:00.000Z' });
assert.equal(thresholdAccrual.buybackAmount, Number((5 * BUYBACK_POLICY.effectivePercentOfCreatorFees / 100).toFixed(9)));
const ready = evaluateBuybackBatch({ pendingAmount: 0.25, asset: 'SOL', now: '2026-09-18T02:00:00.000Z', lastExecutionAt: '2026-09-18T01:00:00.000Z', quote: { routeVerified: true, ageSeconds: 2, slippageBps: 50, priceImpactBps: 40, poolLiquidityAmount: 1000 } });
assert.equal(ready.executable, true);
assert.equal(ready.executionAmount, 0.25);

const blocked = evaluateBuybackBatch({ pendingAmount: 1, asset: 'SOL', quote: { routeVerified: true, ageSeconds: 2, slippageBps: 50, priceImpactBps: 80, poolLiquidityAmount: 1000 } });
assert.equal(blocked.executable, false);
assert.equal(blocked.reason, 'price-impact-limit');

const receipt = buildBuybackReceipt({ accrualIds: ['claim-1'], inputAmount: accrual.buybackAmount, tokensBought: 1250, buySignature: 'buy-1', burnSignature: 'burn-1', supplyBefore: 1_000_000, supplyAfter: 998_750, executedAt: '2026-09-18T02:00:00.000Z', mode: 'local-preview' });
const summary = summarizeBuybackLedger([accrual, thresholdAccrual], [receipt]);
assert.equal(summary.pendingByAsset.SOL, thresholdAccrual.buybackAmount);
assert.equal(summary.burnedTokens, 1250);
assert.equal(BUYBACK_POLICY.maximumSlippageBps, 100);

console.log('buyback and burn policy checks passed');
