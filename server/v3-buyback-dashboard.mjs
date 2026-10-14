import { SystemProgram } from '@solana/web3.js';
import { deriveMintVaultsV3 } from '../mint-router-v3.js';
import { v3BuybackSourceSpent, verifiedV3BuybackOrder } from './v3-buyback-orders.mjs';

export const BUYBACK_TRIGGER_LAMPORTS = 5_000_000_000n;

const verifiedBurn = row => verifiedV3BuybackOrder(row)
  && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(row.signature || ''));

export function v3BuybackBudget(state, programId) {
  const byMint = new Map();
  for (const row of Object.values(state.v3Settlements || {})) {
    const launch = state.launches?.[row.mint];
    const collection = state.collections?.[row.collectionSignature];
    const amount = String(row.allocationPlan?.protocol?.buybackLamports || '');
    if (row.status !== 'finalized' || row.allocationPlan?.status !== 'allocated-not-funded'
      || !/^[1-9]\d*$/.test(amount) || !launch?.onchainVerified
      || launch.cluster !== 'devnet' || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId || collection?.signature !== row.collectionSignature
      || collection.mint !== row.mint || collection.status !== 'collected'
      || collection.onchainVerified !== true || collection.programId !== programId) continue;
    const spent = v3BuybackSourceSpent(state, row.collectionSignature, programId);
    const remaining = BigInt(amount) - spent;
    if (remaining < 0n) throw new Error('Verified buyback spend exceeds its fee allocation.');
    const current = byMint.get(row.mint) || 0n;
    byMint.set(row.mint, current + remaining);
  }
  return byMint;
}

export async function readV3BuybackDashboard({ state, programId, connection,
  reserveLamports = null, thresholdLamports = BUYBACK_TRIGGER_LAMPORTS }) {
  const budget = v3BuybackBudget(state, programId);
  const reserve = reserveLamports == null
    ? BigInt(await connection.getMinimumBalanceForRentExemption(0, 'finalized'))
    : BigInt(reserveLamports);
  const vaults = await Promise.all([...budget].map(async ([mint, expected]) => {
    const address = deriveMintVaultsV3(programId, mint)[6];
    try {
      const account = await connection.getAccountInfo(address, 'finalized');
      if (!account || !account.owner.equals(SystemProgram.programId)
        || Buffer.from(account.data || []).length !== 0) return { mint, address:address.toBase58(), status:'unavailable' };
      const balance = BigInt(account.lamports);
      const spendable = balance > reserve ? balance - reserve : 0n;
      return { mint, address:address.toBase58(), status:'verified',
        balanceLamports:String(balance), pendingLamports:String(spendable < expected ? spendable : expected),
        ledgerLamports:String(expected), discrepancy:spendable < expected };
    } catch { return { mint, address:address.toBase58(), status:'unavailable' }; }
  }));
  const complete = vaults.every(row => row.status === 'verified' && !row.discrepancy);
  const total = vaults.reduce((sum, row) => sum + BigInt(row.pendingLamports || '0'), 0n);
  const receipts = Object.values(state.v3BuybackOrders || {}).filter(row =>
    verifiedBurn(row) && row.programId === programId);
  receipts.sort((a, b) => Number(b.slot || 0) - Number(a.slot || 0));
  const last = receipts[0];
  let burnedAt = last?.burnedAt || null;
  if (last && !burnedAt && Number.isSafeInteger(last.slot)) {
    try {
      const blockTime = await connection.getBlockTime(last.slot);
      if (Number.isSafeInteger(blockTime) && blockTime > 0)
        burnedAt = new Date(blockTime * 1000).toISOString();
    } catch { /* Keep the transaction proof even when the block timestamp is unavailable. */ }
  }
  return { status:complete?'verified':budget.size?'partial':'verified',
    cluster:'devnet', custody:'per-mint-program-vaults',
    thresholdLamports:String(thresholdLamports),
    collectedLamports:complete?String(total):null,
    observedLamports:String(total),
    triggerReached:complete && total >= thresholdLamports,
    vaults, lastBurn:last ? { signature:last.signature, slot:last.slot,
      burnedAt, spentLamports:last.spentLamports,
      burnedBaseUnits:last.burnedBaseUnits } : null };
}
