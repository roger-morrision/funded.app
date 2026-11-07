import { PublicKey } from '@solana/web3.js';
import { bondingCurvePda, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda, PUMP_AMM_PROGRAM_ID, getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';
import { decodePumpTrades, decodePumpSwapTrades } from './coin-market.mjs';
import { successfulEventLogs } from './product-trade-index.mjs';
import { migrationOnlyProof } from './product-migration-proof.mjs';
import { verifyV3PumpCollection } from './v3-collection-proof.mjs';
import { loadFinalizedV3Settlement } from './v3-settlement-proof.mjs';
import { v3AllocationPlan } from './v3-allocation-plan.mjs';
import { dailyBonusWindow } from './daily-bonus.mjs';
import { completeFinalizedEventReceipt } from './finalized-event-receipt.mjs';

// A launch can finish its Pump buy before escrow setup exhausts the log budget.
// Keep original event offsets only if the unobserved instructions cannot invoke
// either market program, including through CPI using their account lists.
function completeMarketPrefix(transaction) {
  const logs = transaction.meta.logMessages;
  const message = transaction.transaction.message;
  if (logs?.at(-1) !== 'Log truncated' || !message?.getAccountKeys) return null;
  const keys = message.getAccountKeys({ accountKeysFromLookups:transaction.meta.loadedAddresses });
  const instructions = message.compiledInstructions;
  let root = -1, lastStart = -1;
  for (const [index, log] of logs.entries()) {
    const match = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[1\]$/.exec(log);
    if (!match) continue;
    const ix = instructions[++root];
    if (!ix || keys.get(ix.programIdIndex)?.toBase58() !== match[1]) return null;
    lastStart = index;
  }
  if (root < 1) return null;
  for (const ix of instructions.slice(root)) {
    for (const index of [ix.programIdIndex, ...ix.accountKeyIndexes]) {
      const key = keys.get(index);
      if (!key || key.equals(PUMP_PROGRAM_ID) || key.equals(PUMP_AMM_PROGRAM_ID)) return null;
    }
  }
  return successfulEventLogs(logs.slice(0, lastStart));
}

export function dailyBonusTradeRows(transaction, reference, mint, pool, decodePoolEvent) {
  if (!transaction || transaction.meta?.err !== null || transaction.slot !== reference.slot
    || transaction.transaction?.signatures?.[0] !== reference.signature
    || !Number.isSafeInteger(transaction.blockTime) || transaction.blockTime !== reference.blockTime) throw new Error('Daily bonus trade proof is unavailable.');
  const rows = [];
  let events;
  try { events = successfulEventLogs(transaction.meta.logMessages); }
  catch (error) {
    // A full, known migration instruction tree proves zero trading volume even
    // when its logs were truncated. Unknown or incomplete trade proofs still block.
    if (['logs-incomplete','logs-unavailable'].includes(error.reason) && migrationOnlyProof(transaction,mint)) return [];
    events = error.reason === 'logs-incomplete' ? completeMarketPrefix(transaction) : null;
    if (!events) throw error;
  }
  for (const event of events) {
    const curve = event.program === PUMP_PROGRAM_ID.toBase58();
    const amm = pool && event.program === PUMP_AMM_PROGRAM_ID.toBase58();
    if (!curve && !amm) continue;
    const decoded = curve ? decodePumpTrades([event.log], mint) : decodePumpSwapTrades([
      `Program ${event.program} invoke [1]`, event.log, `Program ${event.program} success`], pool, decodePoolEvent);
    for (const trade of decoded) rows.push({ signature:reference.signature, logIndex:event.index,
      mint:mint.toBase58(), wallet:new PublicKey(trade.trader).toBase58(),
      blockTime:transaction.blockTime, slot:transaction.slot,
      amountLamports:String(trade.solLamports), finalized:true });
  }
  return rows;
}

// Reuse the independently verified receipt fallback used by launch protections.
// Only missing logs may be recovered; signature, network and balance evidence
// must still agree before any trading volume enters the daily snapshot.
export async function readDailyBonusTradeRows({ connection, transaction, reference, mint, pool,
  decodePoolEvent, decodeTrade = dailyBonusTradeRows, completeReceipt = completeFinalizedEventReceipt }) {
  try { return await decodeTrade(transaction, reference, mint, pool, decodePoolEvent); }
  catch (error) {
    if (!['logs-incomplete', 'logs-unavailable'].includes(error.reason)) throw error;
    const complete = await completeReceipt({ connection, transaction, signature:reference.signature });
    return await decodeTrade(complete, reference, mint, pool, decodePoolEvent);
  }
}

export async function readDailyBonusTrades({ connection, launch, window, maxPages = 20, pageSize = 100 }) {
  const mint = new PublicKey(launch.mint), pool = canonicalPumpPoolPda(mint, NATIVE_MINT);
  const account = await connection.getAccountInfo(pool, 'finalized');
  if (account && !account.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error('Daily bonus pool owner mismatch.');
  // Both addresses are deterministic. Current pool existence must not change
  // a completed day's immutable coverage after a later migration (or closure).
  const routes = [bondingCurvePda(mint), pool];
  const coder = getPumpAmmProgram(connection).coder.events;
  const rows = [];
  for (const address of routes) {
    let before, complete = false, previousSlot = Number.MAX_SAFE_INTEGER;
    const seen = new Set();
    for (let page = 0; page < maxPages; page++) {
      const refs = await connection.getSignaturesForAddress(address, { limit:pageSize, ...(before ? { before } : {}) }, 'finalized');
      if (!Array.isArray(refs) || refs.length > pageSize) throw new Error('Daily bonus trade history page is invalid.');
      for (const ref of refs) {
        if (seen.has(ref.signature)) throw new Error('Daily bonus history cursor repeated.');
        seen.add(ref.signature);
        if (!Number.isSafeInteger(ref.slot) || ref.slot < 1 || ref.slot > previousSlot)
          throw new Error('Daily bonus trade history is not in finalized slot order.');
        previousSlot = ref.slot;
        if (ref.confirmationStatus !== 'finalized' || !Number.isSafeInteger(ref.blockTime))
          throw new Error('Daily bonus trade history has an unresolved time or finality gap.');
        if (ref.err || ref.blockTime < window.start || ref.blockTime >= window.end) continue;
        const tx = await connection.getTransaction(ref.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
        rows.push(...await readDailyBonusTradeRows({ connection, transaction:tx, reference:ref,
          mint, pool, decodePoolEvent:coder.decode.bind(coder) }));
      }
      if (refs.length < pageSize || refs.some(row => row.blockTime < window.start)) { complete = true; break; }
      before = refs.at(-1)?.signature;
    }
    if (!complete) throw new Error('Daily bonus trading coverage exceeds the scan limit; finish indexing before snapshot.');
  }
  return { rows, coverage:{ mint:launch.mint, complete:true, routes:routes.length } };
}

export async function readDailyBonusEvidence({ connection, state, programId, day, now, qaMints,
  readTrades = readDailyBonusTrades, verifyCollection = verifyV3PumpCollection,
  loadSettlement = loadFinalizedV3Settlement }) {
  const window = dailyBonusWindow(day, now);
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Daily bonus RPC is not Devnet.');
  const finalizedSlot = await connection.getSlot('finalized');
  const finalizedTime = await connection.getBlockTime(finalizedSlot);
  if (!Number.isSafeInteger(finalizedTime) || finalizedTime < window.end)
    throw new Error('Wait until the UTC cutoff is finalized on Devnet.');
  const launches = Object.values(state.launches || {}).filter(row => row.onchainVerified === true
    && row.cluster === 'devnet' && row.pumpFeeRoute?.scope === 'per-mint-v3'
    && row.pumpFeeRoute.programId === programId && row.pumpFeeRoute.verified === true
    && (!window.qa || qaMints?.includes(row.mint))
    && Number.isSafeInteger(row.createdTimestamp) && row.createdTimestamp < window.end);
  if (launches.length > 200) throw new Error('Daily bonus mint coverage requires a larger reviewed indexer.');
  const byMint = new Map(launches.map(row => [row.mint, row]));
  const candidates = Object.values(state.collections || {}).filter(row => byMint.has(row.mint)
    && row.scope === 'per-mint-v3' && row.cluster === 'devnet' && row.programId === programId
    && row.status === 'collected' && row.onchainVerified === true && row.attribution === 'mint-verified');
  if (candidates.length > 2_000) throw new Error('Daily bonus collection coverage requires a larger reviewed indexer.');
  const collections = [], trades = [], coverage = [];
  for (const row of candidates) {
    const tx = await connection.getTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
    if (!tx || !Number.isSafeInteger(tx.blockTime)) throw new Error('Daily bonus collection history is incomplete.');
    if (tx.blockTime < window.start || tx.blockTime >= window.end) continue;
    const launch = byMint.get(row.mint), settled = state.v3Settlements?.[row.signature];
    const collected = await verifyCollection({ transaction:tx, signature:row.signature, programId,
      mint:row.mint, expectedLamports:row.collectedLamports });
    if (!collected || settled?.status !== 'finalized') throw new Error('Daily bonus requires a verified collection and finalized settlement.');
    const proof = await loadSettlement({ connection, signature:settled.settlementSignature, programId,
      mint:row.mint, authority:launch.pumpFeeRoute.initialAuthority, creator:launch.creatorWallet,
      claimId:collected.claimId, expectedLamports:row.collectedLamports, split:launch.pumpFeeRoute.protocolSplit });
    if (!proof) throw new Error('Daily bonus settlement proof is unavailable.');
    const plan = v3AllocationPlan({ launch, settlement:{ ...proof, programId,
      collectionSignature:row.signature, settlementSignature:settled.settlementSignature } });
    if (!Array.isArray(settled.referralUpline)) throw new Error('Daily bonus referral attribution has not been frozen.');
    const referrer = settled.referralUpline[0] || null;
    if (referrer && referrer === launch.creatorWallet) throw new Error('Daily bonus self-referral is invalid.');
    collections.push({ signature:row.signature, settlementSignature:settled.settlementSignature,
      mint:row.mint, creator:launch.creatorWallet, referrer, blockTime:tx.blockTime, finalized:true,
      amountLamports:String(collected.expectedLamports), communityLamports:plan.protocol.communityLamports,
      dailyBonusVersion:launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version || null });
  }
  for (const launch of launches.sort((a, b) => a.mint.localeCompare(b.mint))) {
    const result = await readTrades({ connection, launch, window });
    trades.push(...result.rows); coverage.push(result.coverage);
  }
  return { collections, trades, coverage };
}
