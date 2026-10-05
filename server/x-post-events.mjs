import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { rewardAddresses } from './automatic-reward-chain.mjs';
import { verifyRewardProof } from '../reward-merkle.js';
import { verifyCollectionReceipt, verifyPayoutReceipt } from './receipt-evidence.mjs';
import { deriveXFeeObligation } from './x-fee-guard.mjs';
import { verifyPumpLaunch } from './launch-verification.mjs';
import { verifyFundedBurn } from './burn-verification.mjs';
import { listingMemo } from '../listing-policy.js';
import { exactSolLamports } from './exact-sol-units.mjs';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const signatureValid = value => { try { return SIGNATURE.test(value || '') && bs58.decode(value).length === 64; } catch { return false; } };
const DAY = 86_400_000;
const marketingTier = row => {
  const burn = row?.creatorLaunchBurn;
  if (!burn || burn.tier === 'standard' && (!burn.amountTokens || burn.amountTokens === 0) && !burn.receipt) return 'standard';
  return ['pro', 'premier'].includes(burn?.tier) && burn.status === 'verified'
    && Number.isSafeInteger(burn.amountTokens) && burn.amountTokens > 0 ? burn.tier : null;
};
const launchTime = row => Number.isSafeInteger(row?.blockTime) && row.blockTime > 0 ? row.blockTime * 1000
  : Number.isSafeInteger(row?.createdTimestamp) ? row.createdTimestamp * 1000 : time(row?.onchainVerifiedAt);
const positiveUnits = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const time = value => typeof value === 'number' ? value : Date.parse(value);
const iso = value => new Date(value).toISOString();
const identity = (kind, source) => `devnet:${kind}:${createHash('sha256').update(source).digest('hex')}`;
const validProof = proof => proof?.cluster === 'devnet' && proof.commitment === 'finalized' && proof.verified === true
  && signatureValid(proof.signature) && Number.isSafeInteger(proof.slot) && proof.slot > 0;
const stableProof = proof => ({ signature: proof.signature, slot: proof.slot, cluster: 'devnet', commitment: 'finalized', verified: true });
function proofsOf(proofs) {
  if (!Array.isArray(proofs) || !proofs.length || proofs.some(proof => !validProof(proof))) throw new Error('Finalized Devnet proofs are required.');
  const slots = new Map();
  for (const proof of proofs) { if (slots.has(proof.signature) && slots.get(proof.signature) !== proof.slot) throw new Error('Conflicting finalized proof slots.'); slots.set(proof.signature, proof.slot); }
  return [...new Map(proofs.map(proof => [proof.signature, stableProof(proof)])).values()].sort((a, b) => a.signature.localeCompare(b.signature));
}

// Match the formatter's explicit, minute-aligned UTC 24-hour contract. The
// collector chooses completed midnight windows; direct adapters never infer dates.
function dailyWindow(windowStart, windowEnd) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(value)) throw new Error('Daily window requires explicit UTC timestamps.');
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || iso(parsed) !== value.replace(/:00Z$/, ':00.000Z')) throw new Error('Daily window contains an invalid UTC timestamp.');
    return parsed;
  };
  const start = parse(windowStart), end = parse(windowEnd);
  if (end - start !== DAY) throw new Error('Daily window must span exactly 24 hours.');
  return { start, end };
}

/** RPC adapters reverify receipt contents; persisted onchainVerified flags alone are insufficient. */
export function createXPostChainAdapters({ connection, fundedMint, programId, rewardAuthority, maxDailyRecords = 100 }) {
  async function network() {
    if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error('X event verification requires Devnet.');
  }
  async function finalized(signature) {
    const tx = await connection.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err !== null || !Number.isSafeInteger(tx.slot) || tx.slot < 1 || !tx.transaction?.signatures?.includes(signature)
      || !Number.isSafeInteger(tx.blockTime) || tx.blockTime <= 0) throw new Error('Finalized event receipt is unavailable.');
    return { transaction: tx, signature, slot: tx.slot, blockTime: tx.blockTime, cluster: 'devnet', commitment: 'finalized', verified: true };
  }
  const dailyRewards = async ({ state, rewardState, windowStart, windowEnd }, { start, end }) => {
    await network();
    if (!rewardState || !rewardState.schedules || Array.isArray(rewardState.schedules) || typeof rewardState.schedules !== 'object') throw Object.assign(new Error('A complete automatic reward ledger is required.'), { code: 'DAILY_LEDGER_MISSING' });
    const candidates = Object.values(state.payouts || {}).filter(row => row?.cluster === 'devnet' && row.status === 'paid').map(row => ({ record: row }));
    for (const [scheduleId, schedule] of Object.entries(rewardState.schedules || {})) {
      for (const [recipient, payment] of Object.entries(schedule.payments || {})) {
        if (payment.status === 'paid') candidates.push({ scheduleId, schedule, recipient, payment });
      }
    }
    // The full persisted paid set is checked, because a late ledger write can
    // belong to yesterday's on-chain window. Never truncate to recent records.
    if (!Number.isSafeInteger(maxDailyRecords) || maxDailyRecords < 1 || maxDailyRecords > 500 || candidates.length > maxDailyRecords) throw Object.assign(new Error('Full daily payout verification exceeds its bounded record budget.'), { code: 'DAILY_HISTORY_BUDGET' });
    const payments = [], proofs = [], seen = new Set();
    for (const candidate of candidates) {
      const signature = candidate.record?.signature || candidate.payment?.signature;
      if (!signatureValid(signature)) throw new Error('A recorded paid event lacks its receipt.');
      const proof = await finalized(signature);
      if (proof.blockTime * 1000 < start || proof.blockTime * 1000 >= end) continue;
      let amountLamports, recipient, mint, id;
      if (candidate.record) {
        const record = candidate.record;
        const payoutRecord = record.amountLamports == null ? { ...record, amountLamports: exactSolLamports(record.amountSol) } : record;
        const payoutProof = verifyPayoutReceipt(payoutRecord, proof.transaction);
        if (!payoutProof) throw new Error('Recorded payout does not match finalized balance deltas.');
        amountLamports = String(payoutProof.amountLamports); recipient = payoutProof.to; id = record.id || `${record.source}:${record.claimId}`;
        if (record.source === 'mint-router-settle-mint') {
          const obligation = state.obligations?.[record.obligationId], claim = state.claims?.[record.claimId];
          const derived = deriveXFeeObligation(state, { mint: obligation?.mint, claimSignature: obligation?.claimSignature });
          if (!claim || claim.status !== 'paid' || claim.publicKey !== recipient || claim.obligationId !== obligation.id || claim.xUserId !== obligation.xUserId
            || claim.payoutSignature !== signature || derived.amountLamports !== amountLamports || record.from !== derived.router || record.mint !== derived.mint) throw new Error('Payout does not match its original X entitlement.');
          mint = derived.mint;
          const collection = state.collections?.[derived.claimSignature];
          const source = await finalized(derived.claimSignature);
          if (!verifyCollectionReceipt(collection, source.transaction)) throw new Error('Payout collection provenance is unavailable.');
          proofs.push(source);
        } else if (record.source === 'solana-keeper-referral-claim') {
          const claim = state.referralClaims?.[record.claimId], settlement = state.settlements?.[claim?.settlementSignature];
          const level = settlement?.fundedApp?.referralLevels?.find(row => Number(row.level) === Number(claim?.level));
          const collection = state.collections?.[claim?.settlementSignature];
          const amount = exactSolLamports(claim?.amount);
          if (!claim || claim.status !== 'paid' || claim.asset !== 'SOL' || claim.recipientWallet !== recipient || claim.publicKey !== recipient
            || claim.payoutSignature !== signature || amount !== amountLamports || !level || level.recipient !== recipient || exactSolLamports(level.amount) !== amountLamports || !collection?.mint) throw new Error('Payout does not match its original referral entitlement.');
          const source = await finalized(collection.signature);
          if (!verifyCollectionReceipt(collection, source.transaction)) throw new Error('Referral collection provenance is unavailable.');
          mint = collection.mint; proofs.push(source);
        } else throw new Error('Unsupported paid claim source.');
      } else {
        const { schedule, payment } = candidate;
        if (schedule.asset !== 'SOL' || schedule.manifest?.asset !== 'SOL' || payment.finalized !== true || payment.balanceDeltaVerified !== true || !programId || !rewardAuthority) throw new Error('A supported SOL reward configuration is required.');
        recipient = candidate.recipient; amountLamports = String(payment.amount); mint = schedule.mint; id = `${candidate.scheduleId}:${recipient}`;
        const leaf = schedule.manifest.leaves?.find(row => row.recipient === recipient);
        if (!leaf || leaf.amount !== amountLamports || !verifyRewardProof({ cycleId: schedule.manifest.cycleId, asset: 'SOL', recipient, amount: amountLamports, index: leaf.index, proof: leaf.proof, root: schedule.manifest.root })) throw new Error('Scheduled payout entitlement does not match its Merkle manifest.');
        const addresses = rewardAddresses({ programId, authority: rewardAuthority, mint, cycleId: schedule.manifest.cycleId, recipient });
        if (payment.payment !== addresses.payment.toBase58() || schedule.cycle !== addresses.cycle.toBase58()) throw new Error('Reward payout PDA does not match the manifest.');
        const cycleAccount = await connection.getAccountInfo(addresses.cycle, 'finalized');
        const cycleData = Buffer.from(cycleAccount?.data || []);
        if (!cycleAccount?.owner?.equals(new PublicKey(programId)) || cycleData.length < 173
          || !cycleData.subarray(0, 8).equals(createHash('sha256').update('account:RewardCycle').digest().subarray(0, 8))
          || !cycleData.subarray(8, 40).equals(addresses.vault.toBuffer()) || cycleData.subarray(40, 72).toString('hex') !== schedule.manifest.cycleId
          || cycleData.subarray(72, 104).toString('hex') !== schedule.manifest.root || !cycleData.subarray(104, 136).equals(new PublicKey('11111111111111111111111111111111').toBuffer())
          || cycleData.readBigUInt64LE(136).toString() !== schedule.manifest.totalAmount || cycleData.readUInt32LE(168) !== schedule.manifest.leaves.length) throw new Error('Finalized cycle differs from the reward manifest.');
        const account = await connection.getAccountInfo(addresses.payment, 'finalized');
        const data = Buffer.from(account?.data || []), magic = createHash('sha256').update('account:RewardPayment').digest().subarray(0, 8);
        if (!account?.owner?.equals(new PublicKey(programId)) || data.length < 92 || !data.subarray(0, 8).equals(magic)
          || !data.subarray(8, 40).equals(addresses.cycle.toBuffer()) || !data.subarray(40, 72).equals(new PublicKey(recipient).toBuffer())
          || data.readBigUInt64LE(72).toString() !== amountLamports || data.readUInt32LE(80) !== leaf.index) throw new Error('Finalized payment account differs from the entitlement.');
        const tx = proof.transaction;
        const keys = [...(tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys || []), ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58?.() || key.pubkey?.toBase58?.() || String(key.pubkey || key));
        const delta = address => { const index = keys.indexOf(address); const before = tx.meta.preBalances?.[index], after = tx.meta.postBalances?.[index]; if (index < 0 || !Number.isSafeInteger(before) || !Number.isSafeInteger(after)) throw new Error('Exact reward balances unavailable.'); return BigInt(after) - BigInt(before); };
        const expectedData = Buffer.alloc(24);
        createHash('sha256').update('global:payout_reward_sol').digest().copy(expectedData, 0, 0, 8);
        expectedData.writeBigUInt64LE(BigInt(amountLamports), 8); expectedData.writeUInt32LE(leaf.index, 16); expectedData.writeUInt32LE(leaf.proof.length, 20);
        const payoutData = Buffer.concat([expectedData, ...leaf.proof.map(node => Buffer.from(node, 'hex'))]);
        const expectedKeys = [rewardAuthority, addresses.vault.toBase58(), addresses.cycle.toBase58(), recipient, addresses.payment.toBase58(), '11111111111111111111111111111111'];
        const matchingInstructions = (tx.transaction.message.compiledInstructions || tx.transaction.message.instructions || []).filter(ix => {
          const accounts = ix.accountKeyIndexes || ix.accounts || [];
          const data = typeof ix.data === 'string' ? Buffer.from(bs58.decode(ix.data)) : Buffer.from(ix.data || []);
          return keys[ix.programIdIndex] === programId && accounts.length === expectedKeys.length && accounts.every((index, position) => keys[index] === expectedKeys[position]) && data.equals(payoutData);
        });
        const paymentIndex = keys.indexOf(addresses.payment.toBase58());
        if (matchingInstructions.length !== 1 || tx.meta.preBalances?.[paymentIndex] !== 0 || !(tx.meta.postBalances?.[paymentIndex] > 0)
          || data.readBigInt64LE(84) !== BigInt(proof.blockTime)) throw new Error('Receipt does not uniquely create the verified reward payment.');
        // Self-payouts also pay transaction fees and account rent. Until the complete
        // instruction/rent model is verified, do not present their net as an exact receipt.
        if (recipient === keys[0]) throw new Error('Self-funded reward recipient balance reconciliation is unsupported.');
        if (!keys.includes(addresses.payment.toBase58()) || delta(addresses.vault.toBase58()) !== -BigInt(amountLamports)
          || delta(recipient) !== BigInt(amountLamports)) throw new Error('Finalized reward source or recipient delta does not match.');
      }
      if (!ADDRESS.test(mint || '') || !ADDRESS.test(recipient || '') || !positiveUnits(amountLamports)) throw new Error('Payment identity or amount is unavailable.');
      const unique = `${signature}:${recipient}`;
      if (seen.has(unique)) throw new Error('Duplicate payment receipt in the complete reward ledger.');
      seen.add(unique); proofs.push(proof);
      payments.push({ id, mint, recipient, signature, asset: 'SOL', amountLamports, status: 'paid', finalized: true, balanceDeltaVerified: true });
    }
    return { cluster: 'devnet', windowStart, windowEnd, coverage: 'complete', scope: 'recorded-verified-payouts', payments, proofs };
  };
  // Cache within an explicitly identified poll and requested window. Callers must
  // keep that poll's source snapshot immutable; the collector uses a new token per poll.
  let dailyCache;
  const dailyForPoll = async input => {
    // Validate every public invocation, including cache hits, before any RPC read.
    const window = dailyWindow(input?.windowStart, input?.windowEnd);
    if (!input.batchToken) return dailyRewards(input, window);
    if (dailyCache?.token !== input.batchToken || dailyCache.windowStart !== input.windowStart || dailyCache.windowEnd !== input.windowEnd) {
      dailyCache = { token: input.batchToken, windowStart: input.windowStart, windowEnd: input.windowEnd, result: dailyRewards(input, window) };
    }
    return dailyCache.result;
  };
  return {
    verifiedDailyRewards: dailyForPoll,
    async verifiedDailyProjects(input) {
      const daily = await dailyForPoll(input), totals = new Map();
      for (const payment of daily.payments) totals.set(payment.mint, (totals.get(payment.mint) || 0n) + BigInt(payment.amountLamports));
      return { ...daily, metric: 'paid_rewards_lamports', projects: [...totals].map(([mint, total]) => ({ mint, name: input.state.launches?.[mint]?.name || 'Project', amountLamports: total.toString() })) };
    },
    async verifyLaunch(record) {
      await network();
      const tier = marketingTier(record);
      if (!tier) throw new Error('The registered launch tier is invalid.');
      if (tier !== 'standard' && (!fundedMint || record.creatorLaunchBurn.fundedMint !== fundedMint
        || record.creatorLaunchBurn.receipt?.signature !== record.signature
        || record.creatorLaunchBurn.receipt?.verified !== true
        || record.creatorLaunchBurn.receipt?.atomicWithPumpLaunch !== true))
        throw new Error('A verified paid $FUNDED launch tier is required.');
      const verified = await verifyPumpLaunch({ connection, mint: record.mint, signature: record.signature, commitment: 'finalized',
        ...(tier === 'standard' ? {} : { promotionClaim: record.creatorLaunchBurn, fundedMint,
          promotionTiers: [{ id: tier, label: tier, amountTokens: record.creatorLaunchBurn.amountTokens }] }) });
      if (verified.feePayer !== record.creatorWallet || verified.creator !== record.creator
        || (tier === 'standard' ? Boolean(verified.creatorLaunchBurn)
          : verified.creatorLaunchBurn?.tier !== tier || verified.creatorLaunchBurn?.amountTokens !== record.creatorLaunchBurn.amountTokens))
        throw new Error('Launch identity or paid burn differs from the registered policy.');
      const proof = await finalized(record.signature);
      return { mint: verified.mint, name: verified.name, symbol: verified.symbol, marketingTier: tier,
        proofs: [proof], occurredAt: iso(proof.blockTime * 1000) };
    },
    async verifyListing(record) {
      await network();
      if (!fundedMint || record.fundedMint !== fundedMint || !positiveUnits(record.amountBaseUnits)) throw new Error('Listing burn policy is unavailable.');
      await verifyFundedBurn({ connection, signature: record.signature, fundedMint, wallet: record.wallet, amountBaseUnits: record.amountBaseUnits, expectedMemo: listingMemo(record.mint) });
      const proof = await finalized(record.signature);
      return { mint: record.mint, name: record.name, symbol: record.symbol, listingType: 'paid', proofs: [proof], occurredAt: iso(proof.blockTime * 1000) };
    },
  };
}

/**
 * Read-only collector. Persist returned cursor ONLY in the same transaction as all
 * formatted outbox events. On enqueue failure retain the old cursor and retry.
 * enabledAt is a durable activation baseline, not the current polling time.
 * Timestamp-boundary IDs preserve late arrivals at the current highwater time.
 * A separate cyclic ID sweep reconciles older insertions from the loaded snapshot.
 * Its proof/deduplication work is bounded; loading and sorting the snapshot is not
 * an indexed backfill and still scales with the recorded source history.
 * Daily providers must cover the exact full UTC day and reverify every included
 * transaction. Bounded dashboard caches and user-supplied aggregates are not providers.
 */
export async function collectXPostEvents({ state = {}, rewardState = null, enabledAt, now = Date.now(), cursor = null, adapters = {}, maxBatch = 50, minProfitLamports = '1000000000' } = {}) {
  const nowMs = time(now), baseline = time(enabledAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(baseline) || baseline > nowMs) throw new Error('A valid past or current activation time is required.');
  if (!Number.isSafeInteger(maxBatch) || maxBatch < 1 || maxBatch > 200) throw new Error('Collector batch must be from 1 to 200.');
  if (!positiveUnits(minProfitLamports)) throw new Error('A positive profit threshold in lamports is required.');
  if (cursor && (cursor.version !== 1 || cursor.enabledAt !== iso(baseline))) throw new Error('Collector cursor activation baseline differs; explicitly reset before changing it.');
  const firstStream = cursor?.nextStream ?? 0;
  if (!Number.isInteger(firstStream) || firstStream < 0 || firstStream > 5) throw new Error('Invalid event stream scheduling cursor.');
  const events = [], sourceGaps = [], batchToken = Symbol('x-event-poll');
  const gap = (source, reason, id = null) => sourceGaps.push({ source, reason, ...(id ? { id } : {}) });
  const next = { version: 1, enabledAt: iso(baseline), streams: structuredClone(cursor?.streams || {}), lastPolledAt: iso(nowMs), nextStream: (firstStream + 1) % 6 };
  let budget = maxBatch;
  const known = async id => typeof adapters.isKnownEvent === 'function' && await adapters.isKnownEvent(id);
  const end = Math.floor(nowMs / DAY) * DAY, start = end - DAY;
  const streams = [
    { kind: 'launch', rows: Object.values(state.launches || {}).filter(row => row?.onchainVerified === true && row.cluster === 'devnet' && marketingTier(row)), verifier: adapters.verifyLaunch,
      at: row => Number.isFinite(time(row.onchainVerifiedAt)) ? time(row.onchainVerifiedAt) : Number.isSafeInteger(row.createdTimestamp) ? row.createdTimestamp * 1000 : NaN, identity: row => `${row.mint}:${row.signature}` },
    { kind: 'listing', rows: Object.values(state.listings || {}).filter(row => row?.onchainVerified === true && row.cluster === 'devnet' && row.status === 'listed'), verifier: adapters.verifyListing,
      at: row => time(row.listedAt), identity: row => `${row.mint}:${row.signature}` },
    // No existing public opt-in ingestion exists. This explicit namespace must be
    // populated only after a wallet-signed, purpose-specific public-sharing consent.
    { kind: 'trade_profit', rows: Object.values(state.xPublicTradeShares || {}).filter(row => row?.cluster === 'devnet' && row.publicConsent === true && row.consentVerified === true), verifier: adapters.verifyPublicClosedTrade,
      at: row => time(row.consentedAt), identity: row => `${row.wallet}:${row.mint}:${row.buySignature}:${row.sellSignature}` },
    { kind: 'daily_projects', daily: true, provider: adapters.verifiedDailyProjects },
    { kind: 'daily_rewards', daily: true, provider: adapters.verifiedDailyRewards },
    { kind: 'launch_followup', rows: Object.values(state.launches || {}).filter(row => row?.onchainVerified === true && row.cluster === 'devnet' && marketingTier(row) === 'premier'), verifier: adapters.verifyLaunch,
      at: row => launchTime(row) + DAY, identity: row => `${row.mint}:${row.signature}` },
  ];
  // Each kind gets first priority within six polls, even with a one-item budget.
  // Otherwise repeated known older rows could starve later streams indefinitely.
  const orderedStreams = [...streams.slice(firstStream), ...streams.slice(0, firstStream)];
  for (const [streamIndex, stream] of orderedStreams.entries()) {
    if (stream.daily) { await collectDaily(stream.kind, stream.provider); continue; }
    if (typeof stream.verifier !== 'function') { gap(stream.kind, stream.kind === 'trade_profit' ? 'No authenticated public trade-consent and complete realized-cost-basis verifier is configured.' : 'A finalized on-chain event verifier is required.'); continue; }
    const position = next.streams[stream.kind] || { after: null, pending: [] };
    if (!Array.isArray(position.pending) || position.pending.length > 200 || position.after && (!Number.isFinite(position.after.at) || typeof position.after.id !== 'string')) throw new Error('Invalid event cursor.');
    const eventId = id => typeof id === 'string' && /^devnet:[a-z_]+:[0-9a-f]{64}$/.test(id);
    if (position.nextClass != null && (!Number.isInteger(position.nextClass) || position.nextClass < 0 || position.nextClass > 2)) throw new Error('Invalid event scheduling cursor.');
    if (position.reconciliation != null && (!eventId(position.reconciliation.throughId)
      || position.reconciliation.afterId !== null && (!eventId(position.reconciliation.afterId) || position.reconciliation.afterId > position.reconciliation.throughId))) throw new Error('Invalid event reconciliation cursor.');
    const seenIds = new Set();
    const rows = stream.rows.filter(row => ADDRESS.test(row.mint || '') && (stream.kind === 'trade_profit' || signatureValid(row.signature)))
      .map(row => ({ row, at: stream.at(row), id: identity(stream.kind, stream.identity(row)) }))
      .filter(item => Number.isFinite(item.at) && item.at >= baseline && item.at <= nowMs)
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .filter(item => { if (seenIds.has(item.id)) return false; seenIds.add(item.id); return true; });
    const legacyBoundary = position.after && position.boundaryIds == null;
    if (legacyBoundary && typeof adapters.isKnownEvent !== 'function') {
      gap(stream.kind, 'A legacy timestamp cursor requires durable outbox deduplication before boundary reconciliation.');
      continue;
    }
    if (position.boundaryIds != null && (!Array.isArray(position.boundaryIds) || position.boundaryIds.length > 500
      || position.boundaryIds.some(id => typeof id !== 'string' || !/^devnet:[a-z_]+:[0-9a-f]{64}$/.test(id)))) throw new Error('Invalid event timestamp boundary.');
    let boundaryIds = new Set(position.boundaryIds || []);
    const pending = new Set(position.pending);
    if (position.reconciliationPending != null && (!Array.isArray(position.reconciliationPending) || position.reconciliationPending.length > 200
      || new Set(position.reconciliationPending).size !== position.reconciliationPending.length
      || position.reconciliationPending.some(id => !eventId(id) || !pending.has(id)))) throw new Error('Invalid event reconciliation retry cursor.');
    const reconciliationPending = new Set(position.reconciliationPending || []);
    const clearPending = id => { pending.delete(id); reconciliationPending.delete(id); };
    const canReconcile = typeof adapters.isKnownEvent === 'function';
    const fresh = rows.filter(item => !pending.has(item.id) && (!position.after || item.at > position.after.at || item.at === position.after.at && !boundaryIds.has(item.id)));
    const byId = new Map(rows.map(item => [item.id, item]));
    for (const id of [...pending]) if (!byId.has(id)) { clearPending(id); gap(stream.kind, 'Pending source was removed or is no longer eligible.', id); }
    const retry = [...pending].map(id => byId.get(id)).filter(item => canReconcile || !reconciliationPending.has(item.id));
    if (!canReconcile && reconciliationPending.size) gap(stream.kind, 'Older reconciliation retries require durable outbox deduplication; pending sources are retained.');
    const older = rows.filter(item => position.after && item.at < position.after.at && !pending.has(item.id))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!canReconcile && older.length) gap(stream.kind, 'Older source reconciliation requires durable outbox deduplication.');
    if (canReconcile && !position.reconciliation && older.length) position.reconciliation = { afterId: null, throughId: older.at(-1).id };
    const reconciliation = canReconcile && position.reconciliation;
    const reconcile = reconciliation ? older.filter(item => (!reconciliation.afterId || item.id > reconciliation.afterId) && item.id <= reconciliation.throughId) : [];
    // Persist class rotation so even a one-item stream budget gives retries, fresh
    // sources and older reconciliation a turn. A finite sweep ceiling prevents
    // new higher IDs from continually extending the current pass.
    const remainingSources = orderedStreams.slice(streamIndex + 1).filter(nextStream => nextStream.daily
      ? start >= baseline && typeof nextStream.provider === 'function' && next.streams[nextStream.kind]?.windowEnd !== iso(end)
      : typeof nextStream.verifier === 'function' && nextStream.rows.length).length;
    let streamBudget = Math.max(1, Math.floor(budget / (remainingSources + 1)));
    const queues = [retry, fresh, reconcile], offsets = [0, 0, 0], blocked = [false, false, false];
    let nextClass = position.nextClass ?? 0;
    while (budget > 0 && streamBudget > 0) {
      let selected = -1;
      for (let step = 0; step < queues.length; step += 1) {
        const kind = (nextClass + step) % queues.length;
        const candidate = queues[kind][offsets[kind]];
        if (!candidate || blocked[kind]) continue;
        if (kind !== 0 && pending.size >= 200) {
          gap(stream.kind, 'Pending verification capacity is full; fresh and reconciliation cursors have not advanced.');
          blocked[kind] = true; continue;
        }
        if (kind === 1 && position.after?.at === candidate.at && boundaryIds.size >= 500) {
          gap(stream.kind, 'Timestamp boundary capacity is full; highwater has not advanced. Reconcile this source before continuing.');
          blocked[kind] = true; continue;
        }
        selected = kind; break;
      }
      if (selected < 0) break;
      const item = queues[selected][offsets[selected]++];
      nextClass = (selected + 1) % queues.length;
      budget -= 1; streamBudget -= 1;
      if (selected === 1) {
        if (position.after?.at !== item.at) boundaryIds = new Set();
        boundaryIds.add(item.id);
        position.after = { at: item.at, id: item.id };
      }
      if (selected === 2) reconciliation.afterId = item.id;
      try {
        if (await known(item.id)) { clearPending(item.id); continue; }
        if (stream.kind === 'launch_followup' && (typeof adapters.isPostedEvent !== 'function'
          || !await adapters.isPostedEvent(identity('launch', `${item.row.mint}:${item.row.signature}`))))
          throw new Error('The Premier launch post must be published before its follow-up.');
        const verified = await stream.verifier(item.row, { state, rewardState });
        const proofs = proofsOf(verified?.proofs);
        const observed = time(verified.occurredAt);
        if (verified.mint !== item.row.mint || !Number.isFinite(observed) || observed > nowMs) throw new Error('Verified event identity or timestamp does not match its source.');
        if (observed < baseline) { clearPending(item.id); continue; } // Old receipts never become launch announcements through a new registry write.
        if ((stream.kind === 'launch' || stream.kind === 'launch_followup')
          && verified.marketingTier !== marketingTier(item.row)) throw new Error('Verified marketing tier differs from the registered burn.');
        let payload;
        if (stream.kind === 'trade_profit') {
          if (verified.publicConsent !== true || verified.completeCostBasis !== true || verified.positionClosed !== true || proofs.length < 2
            || verified.wallet !== item.row.wallet || !proofs.some(proof => proof.signature === item.row.buySignature) || !proofs.some(proof => proof.signature === item.row.sellSignature)
            || !positiveUnits(verified.buyCostLamports) || !positiveUnits(verified.sellProceedsLamports) || !/^(?:0|[1-9]\d*)$/.test(verified.feesLamports || '')) throw new Error('Verified closed-position cost basis, fees and public consent are required.');
          if (BigInt(verified.sellProceedsLamports) - BigInt(verified.buyCostLamports) - BigInt(verified.feesLamports) < BigInt(minProfitLamports)) { clearPending(item.id); continue; }
          payload = { mint: verified.mint, name: verified.name, publicConsent: true, completeCostBasis: true, positionClosed: true, buyCostLamports: verified.buyCostLamports, sellProceedsLamports: verified.sellProceedsLamports, feesLamports: verified.feesLamports, proofs };
        } else {
          if (!proofs.some(proof => proof.signature === item.row.signature)) throw new Error('Verified proof does not match the recorded signature.');
          payload = { mint: verified.mint, name: verified.name, symbol: verified.symbol,
            ...(stream.kind === 'listing' ? { listingType: 'paid' } : {}),
            ...(['launch', 'launch_followup'].includes(stream.kind) ? { marketingTier: verified.marketingTier } : {}), proofs };
        }
        events.push({ id: item.id, kind: stream.kind, cluster: 'devnet', occurredAt: iso(observed), payload });
        clearPending(item.id);
      } catch {
        pending.delete(item.id); pending.add(item.id);
        if (selected === 2) reconciliationPending.add(item.id);
        gap(stream.kind, 'Finalized evidence is unavailable or mismatched; retry is retained without publishing.', item.id);
      }
    }
    // Wrap only after exhausting this sweep; a later poll catches insertions
    // behind afterId. Failed verification is already retained in pending above.
    if (reconciliation && offsets[2] === reconcile.length && !blocked[2]) position.reconciliation = null;
    position.nextClass = nextClass;
    position.reconciliationPending = [...reconciliationPending];
    position.pending = [...pending]; position.boundaryIds = [...boundaryIds]; next.streams[stream.kind] = position;
  }
  // Only the latest completed UTC day is eligible: outages cannot trigger a backlog
  // of old daily posts. The first daily window must begin after activation.
  async function collectDaily(kind, provider) {
    if (typeof provider !== 'function') { gap(kind, kind === 'daily_projects' ? 'A complete finalized 24-hour project metric provider is not configured; confirmed or partial market caches are excluded.' : 'Complete finalized payout and entitlement verification across the requested reward sources is not configured.'); return; }
    if (start < baseline || budget <= 0 || next.streams[kind]?.windowEnd === iso(end)) return;
    const id = identity(kind, `${iso(start)}:${iso(end)}`);
    budget -= 1;
    try {
      if (await known(id)) { next.streams[kind] = { windowEnd: iso(end) }; return; }
      const result = await provider({ state, rewardState, batchToken, cluster: 'devnet', windowStart: iso(start), windowEnd: iso(end) });
      if (result?.coverage !== 'complete' || result.cluster !== 'devnet' || result.windowStart !== iso(start) || result.windowEnd !== iso(end)) throw new Error('Incomplete or mismatched daily window.');
      const proofs = proofsOf(result.proofs);
      const payload = { windowStart: iso(start), windowEnd: iso(end), coverage: 'complete', proofs };
      if (kind === 'daily_projects') {
        if (!['volume_lamports', 'paid_rewards_lamports'].includes(result.metric) || !Array.isArray(result.projects) || !result.projects.length
          || result.projects.some(row => !ADDRESS.test(row.mint || '') || !positiveUnits(row.amountLamports))
          || new Set(result.projects.map(row => row.mint)).size !== result.projects.length) throw new Error('Complete exact trading volumes are required.');
        if (result.metric === 'paid_rewards_lamports' && result.scope !== 'recorded-verified-payouts') throw new Error('Verified paid-reward ranking requires its recorded scope.');
        payload.metric = result.metric;
        if (result.scope === 'recorded-verified-payouts') payload.scope = result.scope;
        payload.projects = result.projects.map(({ mint, name, amountLamports }) => ({ mint, name, amountLamports })).sort((a, b) => BigInt(a.amountLamports) > BigInt(b.amountLamports) ? -1 : BigInt(a.amountLamports) < BigInt(b.amountLamports) ? 1 : a.mint.localeCompare(b.mint));
      } else {
        if (!Array.isArray(result.payments) || !result.payments.length || result.scope !== 'recorded-verified-payouts') throw new Error('Complete recorded payment scope is required.');
        const seen = new Set(), transfers = new Set();
        payload.payments = result.payments.map(payment => {
          if (typeof payment.id !== 'string' || !payment.id || seen.has(payment.id) || transfers.has(`${payment.signature}:${payment.recipient}`) || payment.status !== 'paid' || payment.finalized !== true || payment.balanceDeltaVerified !== true
            || !ADDRESS.test(payment.recipient || '') || payment.asset !== 'SOL' || !positiveUnits(payment.amountLamports) || !proofs.some(proof => proof.signature === payment.signature)) throw new Error('Unsupported asset, duplicate or unverified payment.');
          seen.add(payment.id); transfers.add(`${payment.signature}:${payment.recipient}`);
          return { id: payment.id, recipient: payment.recipient, signature: payment.signature, asset: 'SOL', amountLamports: payment.amountLamports, status: 'paid', finalized: true, balanceDeltaVerified: true };
        }).sort((a, b) => a.id.localeCompare(b.id));
        payload.scope = result.scope;
      }
      events.push({ id, kind, cluster: 'devnet', occurredAt: iso(end), payload });
      next.streams[kind] = { windowEnd: iso(end) };
    } catch (error) {
      const diagnostics = { DAILY_HISTORY_BUDGET: 'The complete paid-record history exceeds the configured verification budget (default 100, maximum 500). Configure a complete indexed interval provider; no partial daily total is published.', DAILY_LEDGER_MISSING: 'The complete automatic reward ledger is unavailable. Configure its persisted source; an absent ledger is not empty coverage.' };
      gap(kind, diagnostics[error?.code] || 'Daily evidence is incomplete, mixed-asset, invalid or unavailable; no summary was emitted.', id);
    }
  }
  return { events, cursor: next, sourceGaps, scannedThrough: iso(nowMs), publishAuthorized: false };
}
