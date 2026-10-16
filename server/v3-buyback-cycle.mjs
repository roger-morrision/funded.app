import { v3BuybackId, v3BuybackOnchainId } from './v3-buyback-instruction.mjs';
import { v3BuybackNextOrder, v3BuybackSourceSpent } from './v3-buyback-orders.mjs';

export const onchainBuybackSource = mint => `onchain:${mint}`;

export function queueV3BuybackCycle(current, { dashboard, programId, hash, cycleId }) {
  current.v3BuybackOrders ||= {};
  for (const settlement of Object.values(current.v3Settlements || {})) {
    const source = settlement.collectionSignature;
    const linked = current.launches?.[settlement.mint];
    const collected = current.collections?.[source];
    const next = v3BuybackNextOrder(current, source);
    const remaining = BigInt(settlement.allocationPlan?.protocol?.buybackLamports || '0')
      - v3BuybackSourceSpent(current, source, programId);
    if (settlement.status !== 'finalized'
      || settlement.allocationPlan?.status !== 'allocated-not-funded'
      || !linked?.onchainVerified || linked.pumpFeeRoute?.programId !== programId
      || collected?.signature !== source || collected.onchainVerified !== true
      || collected.programId !== programId || remaining <= 0n || next.row) continue;
    current.v3BuybackOrders[next.key] = {
      status:'queued', mint:settlement.mint, collectionSignature:source,
      programId, approvedHash:hash.toLowerCase(),
      buybackId:v3BuybackId([source], next.round).toString('hex'),
      maxTotalDebit:String(remaining), round:next.round, cycleId,
      queuedAt:new Date().toISOString(),
    };
  }
  for (const vault of dashboard.unindexedStatus === 'verified'
    ? dashboard.unindexedVaults || [] : []) {
    if (vault.status !== 'verified' || !/^[1-9]\d*$/.test(String(vault.pendingLamports || ''))
      || !vault.creator || !vault.initialAuthority
      || Object.values(current.v3Settlements || {}).some(row => row.mint === vault.mint)) continue;
    const source = onchainBuybackSource(vault.mint);
    const next = v3BuybackNextOrder(current, source);
    if (next.row) continue;
    current.v3BuybackOrders[next.key] = {
      status:'queued', mint:vault.mint, collectionSignature:source,
      sourceKind:'onchain-policy', creator:vault.creator,
      initialAuthority:vault.initialAuthority,
      programId, approvedHash:hash.toLowerCase(),
      buybackId:v3BuybackOnchainId(vault.mint, next.round).toString('hex'),
      maxTotalDebit:String(vault.pendingLamports), round:next.round, cycleId,
      queuedAt:new Date().toISOString(),
    };
  }
}
