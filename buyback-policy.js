import { FEE_DISTRIBUTION } from './distribution-policy.js';

export const BUYBACK_POLICY = Object.freeze({
  percentOfFundedRevenue: FEE_DISTRIBUTION.buybackRateOfFundedRevenue,
  effectivePercentOfCreatorFees: FEE_DISTRIBUTION.buybackEffectivePercent,
  acceptedAssets: Object.freeze(['SOL', 'USDC']),
  minimumBatch: Object.freeze({ SOL: 0.25, USDC: 50 }),
  maximumWaitHours: 6,
  maximumSlippageBps: 100,
  maximumPriceImpactBps: 75,
  maximumLiquidityClipBps: 25,
  burnInstruction: 'BurnChecked',
  unspentFundsRule: 'remain-in-dedicated-buyback-vault',
  execution: 'protected-swap-then-burn',
});

function requireFiniteNonNegative(value, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(`${label} must be a non-negative number.`);
  return normalized;
}

function normalizeAsset(asset) {
  const normalized = String(asset || 'SOL').trim().toUpperCase();
  if (!BUYBACK_POLICY.acceptedAssets.includes(normalized)) throw new Error(`Buyback asset must be ${BUYBACK_POLICY.acceptedAssets.join(' or ')}.`);
  return normalized;
}

function roundAmount(value) {
  return Number(Number(value).toFixed(9));
}

export function buildBuybackPolicy({ fundedMint = null } = {}) {
  return {
    source: {
      percentOfFundedRevenue: BUYBACK_POLICY.percentOfFundedRevenue,
      effectivePercentOfCreatorFees: BUYBACK_POLICY.effectivePercentOfCreatorFees,
      basis: 'creator-fees-actually-claimed',
      allocationTiming: 'at-fee-claim',
    },
    vault: {
      type: 'dedicated-solana-pda',
      acceptedAssets: BUYBACK_POLICY.acceptedAssets,
      withdrawalRule: 'no-general-withdrawal-path',
      unspentFundsRule: BUYBACK_POLICY.unspentFundsRule,
    },
    execution: {
      mechanism: BUYBACK_POLICY.execution,
      minimumBatch: BUYBACK_POLICY.minimumBatch,
      maximumWaitHours: BUYBACK_POLICY.maximumWaitHours,
      maximumSlippageBps: BUYBACK_POLICY.maximumSlippageBps,
      maximumPriceImpactBps: BUYBACK_POLICY.maximumPriceImpactBps,
      maximumLiquidityClipBps: BUYBACK_POLICY.maximumLiquidityClipBps,
      routeRequirement: 'verified-funded-market-only',
      staleQuoteRule: 'reject',
      failureRule: 'keep-pending-never-reroute',
    },
    burn: {
      mint: fundedMint || null,
      instruction: BUYBACK_POLICY.burnInstruction,
      destination: 'supply-reduction-not-dead-wallet',
      atomicWithSwapPreferred: true,
    },
    accounting: {
      idempotencyKey: 'fee-claim-transaction-signature',
      requiredProofs: ['fee-claim-signature', 'buy-signature', 'burn-signature', 'supply-before', 'supply-after'],
    },
    productionRequirements: ['audited-buyback-program', 'dedicated-pda-vault', 'verified-funded-mint', 'protected-swap-router', 'permissionless-keeper', 'public-receipt-indexer'],
    status: fundedMint ? 'mint-configured-program-pending' : 'awaiting-funded-mint-and-program',
  };
}

export function buildBuybackAccrual({ claimSignature, grossCreatorFees, asset = 'SOL', claimedAt = new Date().toISOString() }) {
  const signature = String(claimSignature || '').trim();
  if (!signature) throw new Error('A fee-claim transaction signature is required.');
  const gross = requireFiniteNonNegative(grossCreatorFees, 'Gross creator fees');
  const normalizedAsset = normalizeAsset(asset);
  const appRevenue = gross * FEE_DISTRIBUTION.fundedPercent / 100;
  const buybackAmount = appRevenue * BUYBACK_POLICY.percentOfFundedRevenue / 100;
  return {
    id: signature,
    claimSignature: signature,
    asset: normalizedAsset,
    grossCreatorFees: roundAmount(gross),
    fundedRevenue: roundAmount(appRevenue),
    buybackAmount: roundAmount(buybackAmount),
    effectivePercentOfCreatorFees: BUYBACK_POLICY.effectivePercentOfCreatorFees,
    claimedAt: new Date(claimedAt).toISOString(),
    status: 'pending',
  };
}

export function summarizeBuybackLedger(accruals = [], receipts = []) {
  const executedIds = new Set(receipts.flatMap(receipt => receipt.accrualIds || []));
  const pending = accruals.filter(accrual => !executedIds.has(accrual.id));
  return {
    accruedByAsset: sumByAsset(accruals),
    pendingByAsset: sumByAsset(pending),
    burnedTokens: roundAmount(receipts.reduce((total, receipt) => total + Number(receipt.tokensBurned || 0), 0)),
    feeClaimCount: accruals.length,
    executionCount: receipts.length,
  };
}

function sumByAsset(records) {
  return records.reduce((totals, record) => {
    totals[record.asset] = roundAmount((totals[record.asset] || 0) + Number(record.buybackAmount || 0));
    return totals;
  }, {});
}

export function evaluateBuybackBatch({ pendingAmount, asset = 'SOL', lastExecutionAt = null, now = new Date().toISOString(), quote = null }) {
  const normalizedAsset = normalizeAsset(asset);
  const pending = requireFiniteNonNegative(pendingAmount, 'Pending buyback amount');
  const minimumBatch = BUYBACK_POLICY.minimumBatch[normalizedAsset];
  const elapsedHours = lastExecutionAt
    ? Math.max(0, (new Date(now).getTime() - new Date(lastExecutionAt).getTime()) / 3_600_000)
    : 0;
  const thresholdReached = pending >= minimumBatch;
  const maximumWaitReached = pending > 0 && elapsedHours >= BUYBACK_POLICY.maximumWaitHours;
  const eligible = thresholdReached || maximumWaitReached;
  if (!eligible) return { eligible: false, executable: false, reason: 'accumulating', pendingAmount: pending, minimumBatch, elapsedHours };
  if (!quote) return { eligible: true, executable: false, reason: 'protected-quote-required', pendingAmount: pending, minimumBatch, elapsedHours };

  const quoteAgeSeconds = requireFiniteNonNegative(quote.ageSeconds, 'Quote age');
  const slippageBps = requireFiniteNonNegative(quote.slippageBps, 'Quote slippage');
  const priceImpactBps = requireFiniteNonNegative(quote.priceImpactBps, 'Quote price impact');
  const poolLiquidity = requireFiniteNonNegative(quote.poolLiquidityAmount, 'Pool liquidity');
  if (!quote.routeVerified) return { eligible: true, executable: false, reason: 'unverified-funded-route' };
  if (quoteAgeSeconds > 10) return { eligible: true, executable: false, reason: 'stale-quote' };
  if (slippageBps > BUYBACK_POLICY.maximumSlippageBps) return { eligible: true, executable: false, reason: 'slippage-limit' };
  if (priceImpactBps > BUYBACK_POLICY.maximumPriceImpactBps) return { eligible: true, executable: false, reason: 'price-impact-limit' };
  const maximumClip = poolLiquidity * BUYBACK_POLICY.maximumLiquidityClipBps / 10_000;
  const executionAmount = roundAmount(Math.min(pending, maximumClip));
  if (executionAmount <= 0) return { eligible: true, executable: false, reason: 'insufficient-verified-liquidity' };
  return { eligible: true, executable: true, reason: 'ready', executionAmount, remainingAmount: roundAmount(pending - executionAmount), maximumClip: roundAmount(maximumClip) };
}

export function buildBuybackReceipt({ accrualIds, asset = 'SOL', inputAmount, tokensBought, buySignature, burnSignature, supplyBefore, supplyAfter, executedAt = new Date().toISOString(), mode = 'production' }) {
  const ids = Array.from(new Set((accrualIds || []).map(String).filter(Boolean)));
  if (!ids.length) throw new Error('At least one accrual id is required.');
  const input = requireFiniteNonNegative(inputAmount, 'Buyback input amount');
  const bought = requireFiniteNonNegative(tokensBought, 'Purchased token amount');
  const before = requireFiniteNonNegative(supplyBefore, 'Supply before burn');
  const after = requireFiniteNonNegative(supplyAfter, 'Supply after burn');
  if (!buySignature || !burnSignature) throw new Error('Buy and burn transaction signatures are required.');
  if (Math.abs((before - bought) - after) > 0.000001) throw new Error('Supply delta must equal the purchased and burned token amount.');
  return {
    id: String(burnSignature),
    accrualIds: ids,
    asset: normalizeAsset(asset),
    inputAmount: roundAmount(input),
    tokensBought: roundAmount(bought),
    tokensBurned: roundAmount(bought),
    buySignature: String(buySignature),
    burnSignature: String(burnSignature),
    burnInstruction: BUYBACK_POLICY.burnInstruction,
    supplyBefore: roundAmount(before),
    supplyAfter: roundAmount(after),
    executedAt: new Date(executedAt).toISOString(),
    mode,
  };
}
