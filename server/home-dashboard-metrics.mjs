import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { validateProtocolFeeSplit } from '../distribution-policy.js';

import { verifiedV3BuybackOrder } from './v3-buyback-orders.mjs';
import { V3_DEVNET_FUNDED_MINT } from './v3-buyback-instruction.mjs';

export function protocolBuybackTotals(state, cluster) {
  if (cluster !== 'devnet' || !state.v3BuybackOrders) return null;
  const receipts = new Map();
  for (const order of Object.values(state.v3BuybackOrders)) {
    if (!verifiedV3BuybackOrder(order) || (order.category ?? 6) !== 6 || order.fundedMint !== V3_DEVNET_FUNDED_MINT.toBase58()) continue;
    const launch = state.launches?.[order.mint];
    if (!launch?.onchainVerified || launch.cluster !== cluster || !order.programId || launch.pumpFeeRoute?.programId !== order.programId) continue;
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(order.signature) || !/^[1-9]\d*$/.test(order.spentLamports) || !/^[1-9]\d*$/.test(order.burnedBaseUnits)) return null;
    const previous = receipts.get(order.signature);
    if (previous && (previous.spentLamports !== order.spentLamports || previous.burnedBaseUnits !== order.burnedBaseUnits || previous.receipt !== order.receipt)) return null;
    receipts.set(order.signature, order);
  }
  let spent = 0n, burned = 0n;
  for (const row of receipts.values()) {
    spent += BigInt(row.spentLamports);
    burned += BigInt(row.burnedBaseUnits);
  }
  return { count: receipts.size, spentLamports: String(spent), burnedBaseUnits: String(burned), mint: V3_DEVNET_FUNDED_MINT.toBase58() };
}

function lamports(value) {
  return /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : 0n;
}

export function homeFeeAllocationSummary(state, evidence, cluster) {
  const coverage = evidence?.coverage || {};
  const recordedCollections = Number(coverage.recordedCollections || 0);
  const evidenceReady = evidence?.cluster === cluster
    && (['onchain-indexed', 'partial'].includes(evidence.status) || (evidence.status === 'no-records' && recordedCollections === 0));
  const verified = new Map((evidenceReady ? evidence.verifiedCollections || [] : [])
    .map(row => [row.signature, row]));
  const totals = { appRevenueLamports:0n, operationsLamports:0n, referralLamports:0n,
      holderLamports:0n, xLamports:0n, buybackLamports:0n, communityLamports:0n,agencyLamports:0n };
  let settledCollections = 0;
  for (const collection of Object.values(state.collections || {})) {
    const proof = verified.get(collection.signature);
    const launch = state.launches?.[collection.mint];
    const settlement = state.v3Settlements?.[collection.signature];
    const plan = settlement?.allocationPlan;
    if (!proof || proof.mint !== collection.mint || proof.collectedLamports !== collection.collectedLamports
      || collection.cluster !== cluster || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.scope !== 'per-mint-v3' || !launch?.onchainVerified || launch.cluster !== cluster
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.pumpFeeRoute.router !== launch.creator
      || settlement?.status !== 'finalized' || settlement.mint !== collection.mint
      || plan?.status !== 'allocated-not-funded'
      || lamports(plan.grossLamports) !== lamports(collection.collectedLamports)) continue;
    const operations = lamports(plan.protocol?.operationsLamports);
    const referrals = (plan.protocol?.referralLamports || []).reduce((sum, row) => sum + lamports(row), 0n);
    const community = lamports(plan.protocol?.communityLamports);
    const buyback = lamports(plan.protocol?.buybackLamports);
    const agency=lamports(plan.agency?.amountLamports);
    totals.appRevenueLamports += operations + referrals + community + buyback + agency;
    totals.agencyLamports+=agency;
    totals.operationsLamports += operations;
    totals.referralLamports += referrals;
    totals.holderLamports += lamports(plan.creatorDirected?.holderLamports);
    totals.xLamports += lamports(plan.creatorDirected?.xLamports);
    totals.buybackLamports += buyback;
    totals.communityLamports += community;
    settledCollections += 1;
  }

  const burns = new Map();
  for (const launch of Object.values(state.launches || {})) {
    const burn = launch.creatorLaunchBurn;
    if (launch.cluster === cluster && launch.onchainVerified && burn?.status === 'verified'
      && burn.receipt?.signature && Number(burn.receipt.amountTokens ?? burn.amountTokens) > 0) {
      burns.set(burn.receipt.signature, Number(burn.receipt.amountTokens ?? burn.amountTokens));
    }
  }
  for (const receipt of Object.values(state.burnReceipts || {})) {
    if (receipt.cluster === cluster && receipt.status === 'verified' && receipt.onchainVerified === true
      && receipt.signature && Number(receipt.amountTokens) > 0) burns.set(receipt.signature, Number(receipt.amountTokens));
  }
  const partial = evidenceReady && (evidence.status === 'partial' || (evidence.verifiedCollections || []).length < recordedCollections);
  let currentPolicy = null;
  try {
    const saved = state.adminSettings?.protocolFeePolicy;
    currentPolicy = {
      split:validateProtocolFeeSplit(saved?.split || PROTOCOL_FEE_SPLIT),
      revision:saved?.revision || 0,
      updatedAt:saved?.updatedAt || null,
      appliesTo:'future launches only',
    };
  } catch { /* Keep the policy unavailable instead of publishing invalid rates. */ }
  return {
    cluster,
    status:evidenceReady ? partial ? 'partial' : 'verified' : 'unavailable',
    scope:'verified-recent-collection-receipts',
    recordedCollections,
    verifiedCollections:verified.size,
    settledCollections,
    currentPolicy,
    ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toString()])),
    protocolBuybacks:protocolBuybackTotals(state, cluster),
    verifiedBurnCount:burns.size,
    burnedTokens:[...burns.values()].reduce((sum, amount) => sum + amount, 0),
  };
}
