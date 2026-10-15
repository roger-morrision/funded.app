import { AUTOMATIC_REWARDS, allocateHolderPool, holdingWeights } from '../automatic-rewards.js';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';
import { snapshotsForPeriod } from './holder-history-indexer.mjs';
import { createHash } from 'node:crypto';
import { NATIVE_MINT } from '@solana/spl-token';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { PublicKey } from '@solana/web3.js';
import { QA_HOLDER_POLICY, qaShortHolderMintSelected } from './devnet-qa-minimums.mjs';

const pricedHolderPolicy = config => ['usd-20-hourly-v1', QA_HOLDER_POLICY]
  .includes(config?.eligibilityPolicy);
const holderUsdMinimum = config => config?.eligibilityPolicy === QA_HOLDER_POLICY
  ? config.qaMinimums.minimumHolderUsd : AUTOMATIC_REWARDS.minimumHolderUsd;
const poolUsdMinimum = config => config?.eligibilityPolicy === QA_HOLDER_POLICY
  ? config.qaMinimums.minimumPoolUsd : AUTOMATIC_REWARDS.minimumPoolUsd;

function excludedHolderWallets(mint, configured = []) {
  const excluded = new Set(configured.map(String));
  let mintKey;
  try { mintKey = new PublicKey(mint); }
  catch { return [...excluded].sort(); /* Unit fixtures may use non-address mint labels. */ }
  excluded.add(canonicalPumpPoolPda(mintKey, NATIVE_MINT).toBase58());
  excluded.add(bondingCurvePda(mintKey).toBase58());
  return [...excluded].sort();
}

function requireUnits(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer string.`);
  return value;
}

function positiveDecimalRatio(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} is unavailable.`);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(numeric));
  if (!match) throw new Error(`${label} is invalid.`);
  const fraction = match[2] || '';
  const exponent = Number(match[3] || 0) - fraction.length;
  if (Math.abs(exponent) > 100) throw new Error(`${label} is outside the supported range.`);
  const digits = BigInt(match[1] + fraction);
  return exponent >= 0 ? { numerator:digits * 10n ** BigInt(exponent), denominator:1n }
    : { numerator:digits, denominator:10n ** BigInt(-exponent) };
}

const ceilDiv = (numerator, denominator) => (numerator + denominator - 1n) / denominator;

export function holderUsdEligibility(quote, closingAccounts, excludedWallets = [], minimumUsd = AUTOMATIC_REWARDS.minimumHolderUsd) {
  const price = Number(quote?.tokenPriceUsd), decimals = Number(quote?.decimals);
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(decimals)
    || decimals < 0 || decimals > 18 || !Number.isFinite(Date.parse(quote?.observedAt))
    || Math.abs(Date.now() - Date.parse(quote.observedAt)) > 5 * 60_000)
    throw new Error('A fresh verified token price is required for holder eligibility.');
  const ratio = positiveDecimalRatio(price, 'Token price');
  const dollars = positiveDecimalRatio(minimumUsd, 'Holder USD minimum');
  const rawMinimum = ceilDiv(dollars.numerator
    * 10n ** BigInt(decimals) * ratio.denominator,
    dollars.denominator * ratio.numerator);
  if (rawMinimum <= 0n || rawMinimum > (1n << 64n) - 1n)
    throw new Error('Token price is too small to calculate the holder minimum safely.');
  const excluded = new Set(excludedWallets);
  const eligible = new Set((closingAccounts || []).filter(row => !excluded.has(row.wallet)
    && BigInt(row.balance) >= rawMinimum).map(row => row.wallet));
  if (eligible.size > AUTOMATIC_REWARDS.maxEligibleHolders)
    throw new Error('Eligible holder count exceeds the configured distribution limit.');
  return { eligible, minimumTokenUnits:String(rawMinimum) };
}

export function holderPoolMinimumLamports(config, quote, recipientCount, env = process.env) {
  const base = holderFundingMinimumLamports(config, env);
  const solUsd = Number(quote?.solUsd);
  if (!Number.isFinite(solUsd) || solUsd <= 0)
    throw new Error('A fresh SOL/USD quote is required for the holder pool minimum.');
  if (!Number.isSafeInteger(recipientCount) || recipientCount < 0
    || recipientCount > AUTOMATIC_REWARDS.maxEligibleHolders)
    throw new Error('Eligible holder count exceeds the configured distribution limit.');
  const ratio = positiveDecimalRatio(solUsd, 'SOL/USD quote');
  const qaPolicy = config?.eligibilityPolicy === QA_HOLDER_POLICY;
  const millidollars = BigInt(Math.round(poolUsdMinimum(config) * 1000))
    + BigInt(recipientCount) * BigInt(qaPolicy ? 0
      : Math.round(AUTOMATIC_REWARDS.costReserveUsdPerHolder * 1000));
  const converted = ceilDiv(millidollars * 1_000_000_000n * ratio.denominator,
    1000n * ratio.numerator);
  return converted > base ? converted : base;
}

function devnetQaShortWindow(config, env = process.env) {
  return qaShortHolderMintSelected(config.mint, env.SOLANA_CLUSTER, env)
    && config.periodSeconds === 300;
}

export function holderFundingMinimumLamports(config, env = process.env) {
  const standard = BigInt(AUTOMATIC_REWARDS.minimumLamports);
  if (config?.eligibilityPolicy === QA_HOLDER_POLICY) {
    if (env.SOLANA_CLUSTER !== 'devnet')
      throw new Error('The Devnet QA holder policy cannot run outside Devnet.');
    return BigInt(config.qaMinimums.minimumFundingLamports);
  }
  if (!devnetQaShortWindow(config, env)) return standard;
  const raw = String(env.FUNDED_QA_HOLDER_MIN_LAMPORTS || '');
  if (!/^[1-9]\d*$/.test(raw)) throw new Error('A numeric Solana QA holder minimum is required.');
  const minimum = BigInt(raw);
  if (minimum < 100_000n || minimum >= standard) throw new Error('Solana QA holder minimum is outside the bounded test range.');
  return minimum;
}

function programConfig(input) {
  const periodSeconds = Number(input.periodSeconds || AUTOMATIC_REWARDS.periodSeconds);
  const sampleIntervalSeconds = Number(input.sampleIntervalSeconds || AUTOMATIC_REWARDS.sampleIntervalSeconds);
  const qaShortPeriod = qaShortHolderMintSelected(String(input.mint),
    process.env.SOLANA_CLUSTER, process.env);
  const minimumPeriodSeconds = qaShortPeriod ? 300 : 3600;
  const payoutDelaySeconds = Number(input.payoutDelaySeconds ?? 3600);
  const activatedAt = Number(input.activatedAt ?? Math.floor(Date.now() / 1000));
  const firstPeriodStart = Number(input.firstPeriodStart ?? Math.ceil(activatedAt / periodSeconds) * periodSeconds);
  if (![periodSeconds, sampleIntervalSeconds, payoutDelaySeconds].every(Number.isSafeInteger) || periodSeconds < minimumPeriodSeconds || sampleIntervalSeconds < 30 || sampleIntervalSeconds > periodSeconds || payoutDelaySeconds < 0) throw new Error('Invalid reward schedule timing.');
  if (![activatedAt, firstPeriodStart].every(Number.isSafeInteger) || activatedAt < 0 || firstPeriodStart < activatedAt || firstPeriodStart % periodSeconds !== 0) throw new Error('Invalid reward program activation time.');
  if (!['SOL', String(input.mint)].includes(String(input.asset || 'SOL'))) throw new Error('Holder rewards must use SOL or the launched token.');
  const qaMinimums = input.eligibilityPolicy === QA_HOLDER_POLICY ? input.qaMinimums : null;
  const qaPoolMillis = Math.round(Number(qaMinimums?.minimumPoolUsd) * 1000);
  const qaHolderCents = Math.round(Number(qaMinimums?.minimumHolderUsd) * 100);
  if (qaMinimums) {
    if (process.env.SOLANA_CLUSTER !== 'devnet'
      || (periodSeconds !== 3600 && !(qaShortPeriod && periodSeconds === 300))
      || !Number.isSafeInteger(qaHolderCents)
      || Math.abs(qaMinimums.minimumHolderUsd * 100 - qaHolderCents) > 1e-6
      || qaHolderCents < 1 || qaHolderCents > 1999
      || !Number.isSafeInteger(qaPoolMillis)
      || Math.abs(qaMinimums.minimumPoolUsd * 1000 - qaPoolMillis) > 1e-6
      || qaPoolMillis < 1 || qaPoolMillis > 19999
      || !Number.isSafeInteger(qaMinimums.minimumFundingLamports) || qaMinimums.minimumFundingLamports < 10_000 || qaMinimums.minimumFundingLamports > 9_999_999)
      throw new Error('The Devnet QA holder policy requires bounded persisted minimums.');
  } else if (input.eligibilityPolicy === QA_HOLDER_POLICY) {
    throw new Error('The Devnet QA holder policy requires persisted minimums.');
  }
  return {
    mint: String(input.mint), enabled: input.enabled !== false, asset: String(input.asset || 'SOL'), kind: 'holder',
    periodSeconds, sampleIntervalSeconds, payoutDelaySeconds, activatedAt, firstPeriodStart,
    eligibilityPolicy: input.eligibilityPolicy || null, qaMinimums,
    excludedWallets: excludedHolderWallets(input.mint, input.excludedWallets || []),
    updatedAt: new Date().toISOString(),
  };
}

function periodsToEnsure(now, periodSeconds) {
  const currentStart = Math.floor(now / periodSeconds) * periodSeconds;
  return [currentStart - periodSeconds, currentStart, currentStart + periodSeconds];
}

function scheduleId(mint, start, asset) { return `${mint}:${start}:holder:${asset}`; }

function publicSchedule(row) {
  return { id: row.id, mint: row.mint, asset: row.asset, kind: row.kind, periodStart: row.periodStart, cutoffAt: row.cutoffAt, payoutAt: row.payoutAt, status: row.status, reason: row.reason || null, recipientCount: row.manifest?.leaves?.length || 0, totalAmount: row.manifest?.totalAmount || null, cycle: row.cycle || null, paidCount: Object.values(row.payments || {}).filter(item => item.status === 'paid').length };
}

export function createRewardScheduler({ store, indexer, chain, quoteReader = null }) {
  async function register(input) {
    return store.transaction(state => {
      state.programs ||= {};
      const prior = state.programs[String(input.mint)];
      const inferredActivation = Number.isFinite(Date.parse(prior?.updatedAt)) ? Math.floor(Date.parse(prior.updatedAt) / 1000) : undefined;
      const config = programConfig({ ...input,
        eligibilityPolicy:input.eligibilityPolicy ?? prior?.eligibilityPolicy,
        qaMinimums:input.qaMinimums === undefined ? prior?.qaMinimums : input.qaMinimums,
        activatedAt:input.activatedAt ?? prior?.activatedAt ?? inferredActivation,
        firstPeriodStart:input.firstPeriodStart ?? prior?.firstPeriodStart });
      if (prior && (prior.periodSeconds !== config.periodSeconds
        || prior.eligibilityPolicy !== config.eligibilityPolicy
        || JSON.stringify(prior.qaMinimums || null) !== JSON.stringify(config.qaMinimums || null))) {
        state.schedules ||= {};
        for (const schedule of Object.values(state.schedules)) {
          if (schedule.mint !== config.mint || schedule.kind !== 'holder'
            || schedule.manifest || schedule.cycle
            || !['indexing', 'blocked', 'deferred'].includes(schedule.status)) continue;
          if (schedule.cutoffAt - schedule.periodStart === config.periodSeconds
            && schedule.periodStart >= config.firstPeriodStart) {
            schedule.status = 'indexing';
            schedule.reason = null;
            continue;
          }
          schedule.status = 'skipped';
          schedule.reason = 'Holder policy replaced this unprepared period; verified funding rolls forward.';
        }
      }
      state.programs[config.mint] = config;
      return structuredClone(config);
    });
  }

  async function recordFundedPool(input) {
    const amount = requireUnits(String(input.amount), 'Pool amount');
    if (!input.id || !input.mint || !input.fundingSignature || input.balanceDeltaVerified !== true) throw new Error('A funded pool requires an immutable ID, mint, finalized funding signature, and verified balance delta.');
    const row = { id: String(input.id), mint: String(input.mint), kind: 'holder', asset: String(input.asset || 'SOL'), amount, fundedAt: Number(input.fundedAt || Math.floor(Date.now() / 1000)), fundingSignature: String(input.fundingSignature), balanceDeltaVerified: true, status: 'available' };
    await store.transaction(state => {
      state.rewardPools ||= {};
      const prior = state.rewardPools[row.id];
      if (prior && ['id', 'mint', 'kind', 'asset', 'amount', 'fundedAt',
        'fundingSignature', 'balanceDeltaVerified'].some(key => prior[key] !== row[key]))
        throw new Error('Reward pool ID already exists with different immutable funding data.');
      state.rewardPools[row.id] ||= row;
    });
    return row;
  }

  async function recordDirectFunded(input) {
    const amount = requireUnits(String(input.amount), 'Direct reward amount');
    if (!input.id || !input.mint || !input.recipient || !input.fundingSignature || input.balanceDeltaVerified !== true || !['creator', 'x', 'community', 'operations'].includes(input.kind)) throw new Error('A direct reward requires a kind, recipient, immutable ID, finalized funding signature, and verified balance delta.');
    const fundedAt = Number(input.fundedAt || Math.floor(Date.now() / 1000));
    const id = `direct:${input.kind}:${input.id}`, cycleId = createHash('sha256').update(`funded-direct-cycle-v1:${id}`).digest('hex');
    const manifest = buildRewardManifest({ cycleId, asset:String(input.asset || 'SOL'), allocations:[{ recipient:String(input.recipient), amount }] });
    const row = { id, mint:String(input.mint), asset:String(input.asset || 'SOL'), kind:input.kind, periodStart:fundedAt - 1, cutoffAt:fundedAt, payoutAt:fundedAt, status:'prepared', sourceId:String(input.id), fundingSignature:String(input.fundingSignature), balanceDeltaVerified:true, manifest, payments:{}, createdAt:new Date().toISOString() };
    return store.transaction(state => {
      state.schedules ||= {};
      const prior = state.schedules[id];
      if (prior) {
        if (prior.manifest?.root !== row.manifest.root || prior.mint !== row.mint
          || prior.kind !== row.kind || prior.asset !== row.asset
          || prior.sourceId !== row.sourceId || prior.fundingSignature !== row.fundingSignature
          || prior.balanceDeltaVerified !== true)
          throw new Error('Direct reward ID already exists with different immutable data.');
        return structuredClone(prior);
      }
      state.schedules[id] = row;
      return structuredClone(row);
    });
  }

  async function recordSnapshotAirdrop(input) {
    const amount = requireUnits(String(input.amount), 'Airdrop reserve amount'), snapshot = input.snapshot;
    if (!input.id || !input.mint || input.asset !== input.mint || !input.eligibilityMint || !input.fundingSignature || input.balanceDeltaVerified !== true) throw new Error('A token airdrop requires the launched-token asset, eligibility mint, immutable ID, finalized funding, and a verified vault delta.');
    if (!snapshot?.finalized || snapshot.mint !== input.eligibilityMint || snapshot.coverage !== 'finalized-sampled-v1') throw new Error('A token airdrop requires a finalized snapshot of its eligibility mint.');
    const excluded = new Set(input.excludedWallets || []), weights = [];
    for (const row of snapshot.accounts || []) if (!excluded.has(row.wallet) && BigInt(row.balance) > 0n) weights.push({ wallet:row.wallet, weight:String(row.balance) });
    const allocation = allocateHolderPool(amount, weights);
    if (!allocation.allocations.length) throw new Error('The finalized eligibility snapshot has no eligible holders.');
    const id = `airdrop:${input.id}`, cycleId = createHash('sha256').update(`funded-snapshot-airdrop-v1:${id}:${snapshot.slot}`).digest('hex');
    const manifest = buildRewardManifest({ cycleId, asset:String(input.asset), allocations:allocation.allocations.map(row => ({ recipient:row.wallet, amount:row.amountLamports })) });
    const payoutAt = Number(input.fundedAt || Math.floor(Date.now() / 1000));
    const row = { id, mint:String(input.mint), eligibilityMint:String(input.eligibilityMint), asset:String(input.asset), kind:'community', periodStart:payoutAt - 1, cutoffAt:payoutAt, payoutAt, status:'prepared', sourceId:String(input.id), fundingSignature:String(input.fundingSignature), balanceDeltaVerified:true, snapshotSlot:snapshot.slot, snapshotAt:snapshot.at, remainderAmount:allocation.remainderLamports, manifest, payments:{}, createdAt:new Date().toISOString() };
    return store.transaction(state => {
      state.schedules ||= {};
      const prior = state.schedules[id];
      if (prior) {
        if (prior.manifest?.root !== row.manifest.root || prior.snapshotSlot !== row.snapshotSlot) throw new Error('Airdrop ID already exists with different immutable snapshot data.');
        return structuredClone(prior);
      }
      state.schedules[id] = row; return structuredClone(row);
    });
  }

  async function prepare(now = Math.floor(Date.now() / 1000)) {
    const snapshot = typeof store.read === 'function' ? await store.read()
      : await store.transaction(state => structuredClone(state));
    const quotedMints = [...new Set(Object.values(snapshot.programs || {})
      .filter(config => {
        if (!config.enabled || !pricedHolderPolicy(config)
          || now < config.firstPeriodStart + config.periodSeconds) return false;
        const total = Object.values(snapshot.rewardPools || {}).filter(pool => pool.mint === config.mint
          && pool.status === 'available' && pool.asset === 'SOL')
          .reduce((sum, pool) => sum + (/^\d+$/.test(String(pool.amount))
            ? BigInt(pool.amount) : 0n), 0n);
        try { return total >= holderFundingMinimumLamports(config); }
        catch { return false; }
      })
      .map(config => config.mint))];
    const quotes = new Map(await Promise.all(quotedMints.map(async mint => {
      try { return [mint, quoteReader ? await quoteReader(mint) : null]; }
      catch { return [mint, null]; }
    })));
    return store.transaction(state => {
      state.programs ||= {}; state.schedules ||= {}; state.holderSnapshots ||= {}; state.rewardPools ||= {};
      for (const row of Object.values(state.schedules)) {
        if (row.kind === 'holder' && row.status === 'skipped' && row.cycle
          && Object.values(row.payments || {}).some(payment => payment.status === 'paid')
          && Object.values(row.payments || {}).filter(payment => payment.status === 'paid').length
            < (row.manifest?.leaves?.length || 0)) {
          row.status = 'blocked';
          row.reason = 'Partly paid holder cycle has an immutable manifest; reconcile its unpaid leaves.';
        }
      }
      for (const config of Object.values(state.programs).filter(item => item.enabled)) {
        if (!Number.isSafeInteger(config.activatedAt)) config.activatedAt = Math.floor(Date.parse(config.updatedAt) / 1000);
        if (!Number.isSafeInteger(config.firstPeriodStart)) config.firstPeriodStart = Math.ceil(config.activatedAt / config.periodSeconds) * config.periodSeconds;
        for (const schedule of Object.values(state.schedules).filter(row => row.mint === config.mint && row.kind === 'holder' && row.periodStart < config.firstPeriodStart && ['indexing', 'blocked'].includes(row.status)
          && !row.manifest && !row.cycle
          && (!devnetQaShortWindow(config) || row.cutoffAt - row.periodStart <= 300))) {
          schedule.status = 'skipped';
          schedule.reason = 'Reward program activated after this period began; rewards roll into the first fully indexed period.';
        }
        for (const start of periodsToEnsure(now, config.periodSeconds)) {
          if (start < config.firstPeriodStart) continue;
          const id = scheduleId(config.mint, start, config.asset);
          const existing = state.schedules[id];
          // A retired hourly row can share this ID with a new five-minute row
          // at an hour boundary. Only replace an unprepared, skipped row; an
          // immutable manifest, cycle, or payment must remain untouched.
          if (!existing || (existing.status === 'skipped'
            && existing.cutoffAt - existing.periodStart !== config.periodSeconds
            && !existing.manifest && !existing.cycle
            && !Object.keys(existing.payments || {}).length)) {
            state.schedules[id] = { id, mint: config.mint, asset: config.asset, kind: config.kind, periodStart: start, cutoffAt: start + config.periodSeconds, payoutAt: start + config.periodSeconds + config.payoutDelaySeconds, status: 'indexing', payments: {}, createdAt: new Date().toISOString() };
          }
        }
      }
      const prepared = [];
      for (const schedule of Object.values(state.schedules)) {
        if (!['indexing', 'blocked'].includes(schedule.status) || now < schedule.cutoffAt
          || schedule.manifest || schedule.cycle) continue;
        const config = state.programs[schedule.mint];
        if (!config?.enabled) continue;
        try {
          const pools = Object.values(state.rewardPools).filter(pool => pool.status === 'available' && pool.mint === schedule.mint && pool.asset === schedule.asset && pool.fundedAt >= config.activatedAt && pool.fundedAt < schedule.cutoffAt && pool.balanceDeltaVerified);
          const total = pools.reduce((sum, pool) => sum + BigInt(pool.amount), 0n);
          if (total <= 0n || (schedule.asset === 'SOL' && total < holderFundingMinimumLamports(config))) {
            schedule.status = 'deferred';
            schedule.reason = total <= 0n
              ? 'No balance-verified reward pool was available at cutoff; later funding remains available for a future period.'
              : 'Verified SOL reward funding is below the distribution minimum and carries forward to a future period.';
            schedule.lastCheckedAt = new Date().toISOString();
            continue;
          }
          const snapshots = snapshotsForPeriod(state.holderSnapshots[schedule.mint], schedule.periodStart, schedule.cutoffAt, config.sampleIntervalSeconds * 2);
          const excluded = excludedHolderWallets(schedule.mint, config.excludedWallets || []);
          let weights = holdingWeights({ start: schedule.periodStart, end: schedule.cutoffAt,
            snapshots, excludedWallets:excluded, coverage:'finalized-sampled-v1' });
          if (pricedHolderPolicy(config)) {
            const quote = quotes.get(schedule.mint);
            const { eligible, minimumTokenUnits } = holderUsdEligibility(quote,
              snapshots.at(-1).accounts, excluded, holderUsdMinimum(config));
            weights = weights.filter(row => eligible.has(row.wallet));
            if (!weights.length) throw new Error(`No holder meets the $${holderUsdMinimum(config)}-equivalent closing balance minimum.`);
            const minimum = holderPoolMinimumLamports(config, quote, weights.length);
            if (total < minimum) {
              schedule.status = 'deferred';
              schedule.reason = `Verified holder funding is below the $${poolUsdMinimum(config)}-equivalent pool and distribution-cost threshold; it carries forward.`;
              schedule.lastCheckedAt = new Date().toISOString();
              continue;
            }
            schedule.eligibility = { policy:config.eligibilityPolicy,
              quoteSource:quote.source, quoteObservedAt:quote.observedAt,
              tokenPriceUsd:quote.tokenPriceUsd, solUsd:quote.solUsd,
              minimumTokenUnits, minimumHolderUsd:holderUsdMinimum(config),
              minimumPoolUsd:poolUsdMinimum(config), eligibleCount:weights.length,
              minimumPoolLamports:String(minimum) };
          }
          const allocation = allocateHolderPool(String(total), weights);
          if (!allocation.allocations.length) throw new Error('No eligible holders had positive time-weighted balances.');
          const cycleId = createRewardCycleId({ mint: schedule.mint, kind: schedule.kind, asset: schedule.asset, periodStart: schedule.periodStart, periodEnd: schedule.cutoffAt });
          schedule.manifest = buildRewardManifest({ cycleId, asset: schedule.asset, allocations: allocation.allocations.map(row => ({ recipient: row.wallet, amount: row.amountLamports })) });
          schedule.remainderAmount = allocation.remainderLamports;
          schedule.snapshotSlots = snapshots.map(row => row.slot);
          schedule.poolIds = pools.map(row => row.id).sort();
          schedule.status = now >= schedule.payoutAt ? 'prepared' : 'calculating';
          schedule.reason = null;
          pools.forEach(pool => { pool.status = 'assigned'; pool.scheduleId = schedule.id; });
          prepared.push(structuredClone(schedule));
        } catch (error) {
          schedule.status = 'blocked'; schedule.reason = String(error.message || error); schedule.lastCheckedAt = new Date().toISOString();
        }
      }
      return prepared;
    });
  }

  async function captureDue(now = Math.floor(Date.now() / 1000)) {
    const configs = await store.transaction(state => structuredClone(Object.values(state.programs || {}).filter(item => item.enabled)));
    const captured = [], failures = [];
    for (const config of configs) {
      const due = await store.transaction(state => {
        const last = state.holderSnapshots?.[config.mint]?.at?.(-1);
        return !last || now - last.at >= config.sampleIntervalSeconds;
      });
      if (due) {
        try { captured.push(await indexer.capture(config.mint, now * 1000)); }
        catch { failures.push({ mint:config.mint, reason:'finalized-holder-indexing-unavailable' }); }
      }
    }
    return { captured, failures };
  }

  async function execute(now = Math.floor(Date.now() / 1000), onlyIds = null) {
    const ready = await chain.readiness();
    await store.transaction(state => { state.serviceStatus = { constrainedPayouts: ready.constrainedPayouts === true, reasons: ready.reasons || [], reason: ready.constrainedPayouts ? null : `On-chain automatic payout is unavailable: ${(ready.reasons || []).join(', ')}`, checkedAt: new Date().toISOString() }; });
    if (!ready.constrainedPayouts) return { status: 'unavailable', reasons: ready.reasons, submitted: 0 };
    const selected = onlyIds === null ? null : new Set(onlyIds);
    const plans = await store.transaction(state => structuredClone(Object.values(state.schedules || {}).filter(row =>
      ['prepared', 'distributing'].includes(row.status) && now >= row.payoutAt
      && (selected === null || selected.has(row.id)))));
    let submitted = 0;
    for (const plan of plans) {
      if (plan.kind === 'holder') {
        const configured = await store.transaction(state => state.programs?.[plan.mint]?.excludedWallets || []);
        const excluded = new Set(excludedHolderWallets(plan.mint, configured));
        if (plan.manifest.leaves.some(leaf => excluded.has(leaf.recipient))) {
          await store.transaction(state => { const row = state.schedules[plan.id]; row.status = 'blocked'; row.reason = 'Holder manifest contains a protocol-owned vault or PumpSwap liquidity pool; reconcile before payout.'; });
          continue;
        }
      }
      const cycle = await chain.ensureCycle(plan);
      await store.transaction(state => { const row = state.schedules[plan.id]; row.cycle = cycle.address; row.cycleSignature ||= cycle.signature || null; row.status = 'distributing'; });
      for (const leaf of plan.manifest.leaves) {
        const already = await store.transaction(state => state.schedules[plan.id].payments?.[leaf.recipient]?.status === 'paid');
        if (already) continue;
        try {
          const result = await chain.submitLeaf(plan, leaf);
          if (!result.finalized || !result.balanceDeltaVerified) throw new Error('Payout lacks finalized state and balance-delta evidence.');
          await store.transaction(state => { const row = state.schedules[plan.id]; row.payments[leaf.recipient] = { status: 'paid', amount: leaf.amount, amountReceived: result.amountReceived, index: leaf.index, signature: result.signature, payment: result.payment, finalized: true, balanceDeltaVerified: true, paidAt: new Date().toISOString() }; });
          submitted += result.alreadyPaid ? 0 : 1;
        } catch (error) {
          await store.transaction(state => { const row = state.schedules[plan.id]; row.payments[leaf.recipient] = { status: 'verification-pending', amount: leaf.amount, index: leaf.index, reason: String(error.message || error), checkedAt: new Date().toISOString() }; });
        }
      }
      await store.transaction(state => {
        const row = state.schedules[plan.id], payments = Object.values(row.payments || {});
        if (payments.length === row.manifest.leaves.length && payments.every(item => item.status === 'paid')) { row.status = 'paid'; row.paidAt = new Date().toISOString(); }
      });
    }
    return { status: plans.length ? 'processed' : 'idle', submitted };
  }

  async function tick(now = Math.floor(Date.now() / 1000)) {
    const capture = await captureDue(now);
    await prepare(now);
    const execution = await execute(now);
    if (capture.failures.length) {
      const reasons = capture.failures.map(row => `${row.reason}:${row.mint}`);
      await store.transaction(state => { state.serviceStatus = { constrainedPayouts:false, reasons, reason:'Automatic distributions are paused because complete finalized holder indexing is unavailable.', checkedAt:new Date().toISOString() }; });
      return { ...execution, status:'unavailable', reasons, captured:capture.captured.length };
    }
    return { ...execution, captured:capture.captured.length };
  }

  async function status(now = new Date()) {
    const rows = await store.transaction(state => Object.values(state.schedules || {}).sort((a, b) => b.periodStart - a.periodStart).slice(0, 20).map(publicSchedule));
    const ready = await chain.readiness().catch(error => ({ constrainedPayouts: false, reasons: [String(error.message || error)] }));
    return { policy: AUTOMATIC_REWARDS, serverTime: now.toISOString(), status: ready.constrainedPayouts ? 'active' : 'unavailable', reason: ready.constrainedPayouts ? null : `On-chain automatic payout is unavailable: ${(ready.reasons || []).join(', ')}`, schedules: rows, modes: { creator: 'automatic-after-finalized-funding', holders: 'automatic-SOL-or-token', x: 'automatic-after-verification', community: 'automatic-token-airdrop', referrals: 'manual-claim' } };
  }

  return { register, recordFundedPool, recordDirectFunded, recordSnapshotAirdrop, captureDue, prepare, execute, tick, status };
}
