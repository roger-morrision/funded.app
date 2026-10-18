import { validateFeeDistribution } from '../distribution-policy.js';

const DECIMAL = /^(0|[1-9]\d*)$/;

function lamports(value) {
  if (!DECIMAL.test(String(value))) throw new Error('Finalized V3 allocation contains invalid lamports.');
  return BigInt(value);
}

function shareBps(value) {
  const bps = Math.round(value * 100);
  if (!Number.isSafeInteger(bps) || Math.abs(bps / 100 - value) > 0.000001) {
    throw new Error('Creator-directed V3 shares must use whole basis points.');
  }
  return bps;
}

// This is an obligation plan, not a payment receipt. Only a finalized V3
// settlement proof may supply its seven on-chain category allocations.
export function v3AllocationPlan({ launch, settlement }) {
  if (launch?.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.mint !== settlement?.mint
    || !launch.onchainVerified || launch.cluster !== 'devnet'
    || launch.pumpFeeRoute.programId !== settlement.programId) {
    throw new Error('A matching verified V3 launch and settlement are required.');
  }
  const rows = settlement.categoryLamports;
  if (!Array.isArray(rows) || rows.length !== 7) throw new Error('Seven on-chain V3 categories are required.');
  const category = rows.map(lamports);
  const gross = lamports(settlement.expectedLamports);
  if (gross <= 0n || category.reduce((total, value) => total + value, 0n) !== gross) {
    throw new Error('V3 category allocations do not reconcile to the settled fee amount.');
  }
  const directed = launch.feeDistribution?.creatorDirected;
  const shares = directed?.shares;
  const checked = validateFeeDistribution({ ...shares,
    xRecipient:directed?.recipients?.xAccount || '' });
  if (!checked.valid) throw new Error('The signed creator-directed fee split is invalid.');
  const walletBps = shareBps(checked.shares.creatorWalletPercent);
  const holderBps = shareBps(checked.shares.holderAirdropPercent);
  const xBps = shareBps(checked.shares.solClaimPercent);
  if (walletBps + holderBps + xBps !== 8_000 || xBps > 0 && !/^\d{1,24}$/.test(String(launch.xUserId || ''))) {
    throw new Error('The V3 creator-directed split or X identity is incomplete.');
  }
  const creatorPool = category[0];
  const position = settlement.position;
  const priorPool = position ? lamports(position.creatorPoolBeforeLamports) : 0n;
  const afterPool = position ? lamports(position.creatorPoolAfterLamports) : creatorPool;
  if (afterPool - priorPool !== creatorPool) throw new Error('The cumulative V3 creator pool does not reconcile.');
  const wallet = afterPool * BigInt(walletBps) / 8_000n - priorPool * BigInt(walletBps) / 8_000n;
  const holder = afterPool * BigInt(walletBps + holderBps) / 8_000n
    - priorPool * BigInt(walletBps + holderBps) / 8_000n - wallet;
  const x = creatorPool - wallet - holder;
  if ([wallet,holder,x].some(value=>value<0n)) throw new Error('The collection is too small to release cumulative rounding safely.');
  return {
    status:'allocated-not-funded', sourceCollectionSignature:settlement.collectionSignature,
    settlementSignature:settlement.settlementSignature,
    mint:launch.mint, programId:launch.pumpFeeRoute.programId,
    ...(position ? {allocationVersion:2,creatorPoolBeforeLamports:String(priorPool),creatorPoolAfterLamports:String(afterPool)} : {}),
    grossLamports:String(gross), creatorPoolLamports:String(creatorPool),
    creatorDirected:{ walletLamports:String(wallet), holderLamports:String(holder),
      xLamports:String(x), xUserId:xBps > 0 ? String(launch.xUserId) : null,
      xHandle:xBps > 0 ? directed.recipients.xAccount : null },
    protocol:{ operationsLamports:String(category[1]),
      referralLamports:category.slice(2, 5).map(String),
      communityLamports:String(category[5]), buybackLamports:String(category[6]) },
  };
}

// A finalized transaction remains final even when an older or damaged local
// launch record cannot produce payable obligations. Preserve the chain proof
// and require explicit reconciliation instead of leaving it pending forever.
export function recordedV3AllocationPlan(input) {
  try { return v3AllocationPlan(input); }
  catch { return { status:'blocked', reason:'signed-policy-allocation-unavailable',
    reconciliationRequired:true }; }
}
