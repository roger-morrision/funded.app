import { AUTOMATIC_REWARDS, allocateHolderPool, holdingWeights } from '../automatic-rewards.js';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';
import { snapshotsForPeriod } from './holder-history-indexer.mjs';
import { createHash } from 'node:crypto';

function requireUnits(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer string.`);
  return value;
}

function programConfig(input) {
  const periodSeconds = Number(input.periodSeconds || AUTOMATIC_REWARDS.periodSeconds);
  const sampleIntervalSeconds = Number(input.sampleIntervalSeconds || AUTOMATIC_REWARDS.sampleIntervalSeconds);
  const payoutDelaySeconds = Number(input.payoutDelaySeconds ?? 3600);
  const activatedAt = Number(input.activatedAt ?? Math.floor(Date.now() / 1000));
  const firstPeriodStart = Number(input.firstPeriodStart ?? Math.ceil(activatedAt / periodSeconds) * periodSeconds);
  if (![periodSeconds, sampleIntervalSeconds, payoutDelaySeconds].every(Number.isSafeInteger) || periodSeconds < 3600 || sampleIntervalSeconds < 30 || sampleIntervalSeconds > periodSeconds || payoutDelaySeconds < 0) throw new Error('Invalid reward schedule timing.');
  if (![activatedAt, firstPeriodStart].every(Number.isSafeInteger) || activatedAt < 0 || firstPeriodStart < activatedAt || firstPeriodStart % periodSeconds !== 0) throw new Error('Invalid reward program activation time.');
  if (!['SOL', String(input.mint)].includes(String(input.asset || 'SOL'))) throw new Error('Holder rewards must use SOL or the launched token.');
  return {
    mint: String(input.mint), enabled: input.enabled !== false, asset: String(input.asset || 'SOL'), kind: 'holder',
    periodSeconds, sampleIntervalSeconds, payoutDelaySeconds, activatedAt, firstPeriodStart,
    excludedWallets: [...new Set((input.excludedWallets || []).map(String))].sort(),
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

export function createRewardScheduler({ store, indexer, chain }) {
  async function register(input) {
    return store.transaction(state => {
      state.programs ||= {};
      const prior = state.programs[String(input.mint)];
      const inferredActivation = Number.isFinite(Date.parse(prior?.updatedAt)) ? Math.floor(Date.parse(prior.updatedAt) / 1000) : undefined;
      const config = programConfig({ ...input, activatedAt:input.activatedAt ?? prior?.activatedAt ?? inferredActivation, firstPeriodStart:input.firstPeriodStart ?? prior?.firstPeriodStart });
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
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error('Reward pool ID already exists with different data.');
      state.rewardPools[row.id] ||= row;
    });
    return row;
  }

  async function recordDirectFunded(input) {
    const amount = requireUnits(String(input.amount), 'Direct reward amount');
    if (!input.id || !input.mint || !input.recipient || !input.fundingSignature || input.balanceDeltaVerified !== true || !['creator', 'x', 'community'].includes(input.kind)) throw new Error('A direct reward requires a kind, recipient, immutable ID, finalized funding signature, and verified balance delta.');
    const fundedAt = Number(input.fundedAt || Math.floor(Date.now() / 1000));
    const id = `direct:${input.kind}:${input.id}`, cycleId = createHash('sha256').update(`funded-direct-cycle-v1:${id}`).digest('hex');
    const manifest = buildRewardManifest({ cycleId, asset:String(input.asset || 'SOL'), allocations:[{ recipient:String(input.recipient), amount }] });
    const row = { id, mint:String(input.mint), asset:String(input.asset || 'SOL'), kind:input.kind, periodStart:fundedAt - 1, cutoffAt:fundedAt, payoutAt:fundedAt, status:'prepared', sourceId:String(input.id), fundingSignature:String(input.fundingSignature), balanceDeltaVerified:true, manifest, payments:{}, createdAt:new Date().toISOString() };
    return store.transaction(state => {
      state.schedules ||= {};
      const prior = state.schedules[id];
      if (prior) {
        if (prior.manifest?.root !== row.manifest.root || prior.mint !== row.mint || prior.kind !== row.kind) throw new Error('Direct reward ID already exists with different immutable data.');
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
    return store.transaction(state => {
      state.programs ||= {}; state.schedules ||= {}; state.holderSnapshots ||= {}; state.rewardPools ||= {};
      for (const config of Object.values(state.programs).filter(item => item.enabled)) {
        if (!Number.isSafeInteger(config.activatedAt)) config.activatedAt = Math.floor(Date.parse(config.updatedAt) / 1000);
        if (!Number.isSafeInteger(config.firstPeriodStart)) config.firstPeriodStart = Math.ceil(config.activatedAt / config.periodSeconds) * config.periodSeconds;
        for (const schedule of Object.values(state.schedules).filter(row => row.mint === config.mint && row.kind === 'holder' && row.periodStart < config.firstPeriodStart && ['indexing', 'blocked'].includes(row.status))) {
          schedule.status = 'skipped';
          schedule.reason = 'Reward program activated after this period began; rewards roll into the first fully indexed period.';
        }
        for (const start of periodsToEnsure(now, config.periodSeconds)) {
          if (start < config.firstPeriodStart) continue;
          const id = scheduleId(config.mint, start, config.asset);
          state.schedules[id] ||= { id, mint: config.mint, asset: config.asset, kind: config.kind, periodStart: start, cutoffAt: start + config.periodSeconds, payoutAt: start + config.periodSeconds + config.payoutDelaySeconds, status: 'indexing', payments: {}, createdAt: new Date().toISOString() };
        }
      }
      const prepared = [];
      for (const schedule of Object.values(state.schedules)) {
        if (!['indexing', 'blocked'].includes(schedule.status) || now < schedule.cutoffAt) continue;
        const config = state.programs[schedule.mint];
        if (!config?.enabled) continue;
        try {
          const snapshots = snapshotsForPeriod(state.holderSnapshots[schedule.mint], schedule.periodStart, schedule.cutoffAt, config.sampleIntervalSeconds * 2);
          const weights = holdingWeights({ start: schedule.periodStart, end: schedule.cutoffAt, snapshots, excludedWallets: config.excludedWallets, coverage: 'finalized-sampled-v1' });
          const pools = Object.values(state.rewardPools).filter(pool => pool.status === 'available' && pool.mint === schedule.mint && pool.asset === schedule.asset && pool.fundedAt >= config.activatedAt && pool.fundedAt < schedule.cutoffAt && pool.balanceDeltaVerified);
          const total = pools.reduce((sum, pool) => sum + BigInt(pool.amount), 0n);
          if (total <= 0n) throw new Error('No finalized, balance-verified reward funding was recorded for this period.');
          if (schedule.asset === 'SOL' && total < BigInt(AUTOMATIC_REWARDS.minimumLamports)) throw new Error('Reward pool is below the automatic SOL distribution minimum.');
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

  async function execute(now = Math.floor(Date.now() / 1000)) {
    const ready = await chain.readiness();
    await store.transaction(state => { state.serviceStatus = { constrainedPayouts: ready.constrainedPayouts === true, reasons: ready.reasons || [], reason: ready.constrainedPayouts ? null : `On-chain automatic payout is unavailable: ${(ready.reasons || []).join(', ')}`, checkedAt: new Date().toISOString() }; });
    if (!ready.constrainedPayouts) return { status: 'unavailable', reasons: ready.reasons, submitted: 0 };
    const plans = await store.transaction(state => structuredClone(Object.values(state.schedules || {}).filter(row => ['prepared', 'distributing'].includes(row.status) && now >= row.payoutAt)));
    let submitted = 0;
    for (const plan of plans) {
      const cycle = await chain.ensureCycle(plan);
      await store.transaction(state => { const row = state.schedules[plan.id]; row.cycle = cycle.address; row.cycleSignature ||= cycle.signature || null; row.status = 'distributing'; });
      for (const leaf of plan.manifest.leaves) {
        const already = await store.transaction(state => state.schedules[plan.id].payments?.[leaf.recipient]?.status === 'paid');
        if (already) continue;
        try {
          const result = await chain.submitLeaf(plan, leaf);
          if (!result.finalized || !result.balanceDeltaVerified) throw new Error('Payout lacks finalized state and balance-delta evidence.');
          await store.transaction(state => { const row = state.schedules[plan.id]; row.payments[leaf.recipient] = { status: 'paid', amount: leaf.amount, index: leaf.index, signature: result.signature, payment: result.payment, finalized: true, balanceDeltaVerified: true, paidAt: new Date().toISOString() }; });
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
