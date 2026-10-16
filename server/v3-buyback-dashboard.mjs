import { PublicKey, SystemProgram } from '@solana/web3.js';
import { deriveMintPolicyV3, deriveMintVaultsV3,
  verifyMintRouterV3Account } from '../mint-router-v3.js';
import { v3BuybackSourceSpent, verifiedV3BuybackOrder } from './v3-buyback-orders.mjs';
import { latestUnindexedV3Burn } from './v3-buyback-chain-history.mjs';
import { STANDARD_BUYBACK_TRIGGER_LAMPORTS } from './devnet-qa-minimums.mjs';

export const BUYBACK_TRIGGER_LAMPORTS = STANDARD_BUYBACK_TRIGGER_LAMPORTS;

const verifiedBurn = row => verifiedV3BuybackOrder(row)
  && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(row.signature || ''));

const POLICY_DISCRIMINATOR = Buffer.from('25d0c7eca736c38f', 'hex');

// Old Devnet launches can retain funded vaults after their application records
// have been cleared. The route independently rechecks this policy and custody
// against the approved program before any spend.
export async function readUnindexedV3BuybackVaults({ connection, programId, indexedMints, reserve }) {
  const accounts = await connection.getProgramAccounts(new PublicKey(programId), {
    commitment:'finalized', filters:[{ dataSize:249 }],
  });
  const policies = [];
  for (const { pubkey, account } of accounts) {
    const data = Buffer.from(account.data);
    if (data.length !== 249 || !data.subarray(0, 8).equals(POLICY_DISCRIMINATOR)) continue;
    const mint = new PublicKey(data.subarray(8, 40));
    const derived = deriveMintPolicyV3(programId, mint);
    if (indexedMints.has(mint.toBase58()) || !pubkey.equals(derived.address)
      || data[248] !== derived.bump) continue;
    const rates = Array.from({ length:6 }, (_, index) => data.readUInt32LE(104 + index * 4));
    const paid = Array.from({ length:7 }, (_, index) => data.readBigUInt64LE(136 + index * 8));
    const withdrawn = Array.from({ length:7 }, (_, index) => data.readBigUInt64LE(192 + index * 8));
    const settled = data.readBigUInt64LE(128);
    if (rates.reduce((sum, rate) => sum + rate, 0) !== 2_000_000
      || rates[5] !== 500_000 || paid.reduce((sum, amount) => sum + amount, 0n) !== settled
      || withdrawn.some((amount, index) => amount > paid[index])) continue;
    policies.push({ mint:mint.toBase58(), creator:new PublicKey(data.subarray(40,72)).toBase58(),
      initialAuthority:new PublicKey(data.subarray(72,104)).toBase58(),
      address:deriveMintVaultsV3(programId, mint)[6],
      expected:paid[6] - withdrawn[6] });
  }
  await Promise.all(policies.map(async policy => {
    try {
      policy.routerVerified = (await verifyMintRouterV3Account({ connection, programId,
        mint:policy.mint, initialAuthority:policy.initialAuthority })).verified;
    } catch { policy.routerVerified = false; }
  }));
  const rows = [];
  for (let offset = 0; offset < policies.length; offset += 100) {
    const batch = policies.slice(offset, offset + 100);
    const accounts = typeof connection.getMultipleAccountsInfo === 'function'
      ? await connection.getMultipleAccountsInfo(batch.map(row => row.address), 'finalized')
      : await Promise.all(batch.map(row => connection.getAccountInfo(row.address, 'finalized')));
    for (const [index, policy] of batch.entries()) {
      const vault = accounts[index];
      const { mint, address, expected } = policy;
      const actual = !vault && expected === 0n ? 0n
        : vault?.owner?.equals(SystemProgram.programId) && Buffer.from(vault.data || []).length === 0
          ? BigInt(vault.lamports) > reserve ? BigInt(vault.lamports) - reserve : 0n : null;
      rows.push({ mint, creator:policy.creator, initialAuthority:policy.initialAuthority,
        address:address.toBase58(),
        status:policy.routerVerified && actual === expected ? 'verified' : 'unavailable',
        pendingLamports:policy.routerVerified && actual === expected ? String(expected) : null });
    }
  }
  return rows;
}

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
  const indexedTotal = vaults.reduce((sum, row) => sum + BigInt(row.pendingLamports || '0'), 0n);
  let unindexedVaults = [];
  let unindexedStatus = 'verified';
  try {
    if (typeof connection.getProgramAccounts === 'function')
      unindexedVaults = await readUnindexedV3BuybackVaults({ connection, programId,
        indexedMints:new Set([...budget.keys(),
          ...Object.values(state.v3Settlements || {}).map(row => row.mint).filter(Boolean)]), reserve });
    else unindexedStatus = 'unavailable';
  } catch { unindexedStatus = 'unavailable'; }
  if (unindexedVaults.some(row => row.status !== 'verified')) unindexedStatus = 'partial';
  const unindexedTotal = unindexedVaults.reduce((sum, row) => sum + BigInt(row.pendingLamports || '0'), 0n);
  const total = indexedTotal + unindexedTotal;
  const eligibleTotal = indexedTotal + (unindexedStatus === 'verified' ? unindexedTotal : 0n);
  const verifiedCustody = complete && unindexedStatus === 'verified'
    ? total : null;
  const receipts = Object.values(state.v3BuybackOrders || {}).filter(row =>
    verifiedBurn(row) && row.programId === programId);
  receipts.sort((a, b) => Number(b.slot || 0) - Number(a.slot || 0));
  let chainBurn = null;
  try {
    chainBurn = await latestUnindexedV3Burn({ connection, programId,
      indexedSignatures:new Set(receipts.map(row => row.signature)) });
  } catch { /* Display app receipts when chain history cannot be read. */ }
  const last = chainBurn && (!receipts[0] || chainBurn.slot > receipts[0].slot)
    ? chainBurn : receipts[0];
  let burnedAt = last?.burnedAt || null;
  if (last && !burnedAt && Number.isSafeInteger(last.slot)) {
    try {
      const blockTime = await connection.getBlockTime(last.slot);
      if (Number.isSafeInteger(blockTime) && blockTime > 0)
        burnedAt = new Date(blockTime * 1000).toISOString();
    } catch { /* Keep the transaction proof even when the block timestamp is unavailable. */ }
  }
  return { status:complete?'verified':'partial',
    cluster:'devnet', custody:'per-mint-program-vaults',
    thresholdLamports:String(thresholdLamports),
    collectedLamports:complete?String(eligibleTotal):null,
    observedLamports:String(total),
    triggerReached:complete && eligibleTotal >= thresholdLamports,
    vaults, unindexedVaults, unindexedStatus,
    unindexedLamports:unindexedStatus === 'verified' ? String(unindexedTotal) : null,
    verifiedCustodyLamports:verifiedCustody === null ? null : String(verifiedCustody),
    lastBurn:last ? { signature:last.signature, slot:last.slot,
      burnedAt, spentLamports:last.spentLamports,
      burnedBaseUnits:last.burnedBaseUnits,
      source:last.source || 'app-recorded' } : null };
}
