import { isDeepStrictEqual } from 'node:util';
import { DAILY_BONUS_POLICY } from '../config/daily-bonus.js';
import { verifyMintPolicyV3Account } from '../mint-router-v3.js';
import { createAutomaticRewardChain, rewardAddresses } from './automatic-reward-chain.mjs';
import { buildDailyBonusSnapshot, dailyBonusManifest, latestBonusDay, bonusHash } from './daily-bonus.mjs';
import { createDailyBonusEvidenceIndex } from './daily-bonus-index.mjs';
import { loadFinalizedV3RewardFunding } from './v3-reward-funding-proof.mjs';
import { v3DisbursementId } from './v3-disbursement-id.mjs';
import { bonusDashboardHistory, readBonusPool } from './daily-bonus-dashboard.mjs';
import { DEFAULT_BONUS_SCHEDULE, currentBonusStart, publicBonusSchedule, bonusWindow } from './daily-bonus-schedule.mjs';

export function createDailyBonusService({ store, rewardStore, connection, programId, authority,
  expectedProgramDataSha256, cluster, payoutEnabled = false, readEvidence,
  chainFactory = createAutomaticRewardChain, loadFunding = loadFinalizedV3RewardFunding,
  verifyPolicy = verifyMintPolicyV3Account, now = () => Math.floor(Date.now() / 1000),
  readPool = readBonusPool, poolTimeoutMs = 12_000, schedule = DEFAULT_BONUS_SCHEDULE }) {
  if (cluster !== 'devnet') throw new Error('Daily bonus execution is available only on Devnet.');
  const chain = chainFactory({ connection, programId, authority, expectedProgramDataSha256 });
  const readIndexedEvidence = readEvidence || createDailyBonusEvidenceIndex({ rewardStore });
  let running = false;
  let poolCache, poolRead;
  async function dashboard(options) {
    const at = now();
    if (!poolCache || at - poolCache.at >= 30 || poolCache.day !== currentBonusStart(at,schedule)) {
      poolRead ||= (async () => {
        let value, timer; const controller = new AbortController();
        try {
          value = await Promise.race([
            (async () => readPool({ state:await store.read(), connection, programId, now:at, schedule, signal:controller.signal }))(),
            new Promise(resolve => { timer = setTimeout(() => {
              controller.abort(); resolve({ status:'unavailable', categoryLamports:null });
            }, poolTimeoutMs); timer.unref(); }),
          ]);
        }
        catch { value = { status:'unavailable', categoryLamports:null }; }
        finally { clearTimeout(timer); }
        poolCache = { at, day:currentBonusStart(at,schedule), value };
      })().finally(() => { poolRead = null; });
      await poolRead;
    }
    return { cluster, serverTime:new Date(now() * 1000).toISOString(),
      schedule:publicBonusSchedule(schedule),
      nextCutoffAt:new Date((currentBonusStart(now(),schedule) + schedule.periodSeconds) * 1000).toISOString(),
      poolCheckedAt:new Date(poolCache.at * 1000).toISOString(),
      pool:poolCache.day === currentBonusStart(now(),schedule) ? poolCache.value : { status:'unavailable', categoryLamports:null },
      ...bonusDashboardHistory(await rewardStore.read(), options) };
  }
  const ready = async () => {
    if (!(await chain.readiness()).constrainedPayouts) throw new Error('Daily bonus requires the reviewed V3 program and authority.');
  };
  async function evidenceFor(day, prior) {
    const window = bonusWindow(day,now());
    if (Boolean(window.qa) !== (schedule.periodSeconds === 300)) throw new Error('Snapshot period does not match the active bonus schedule.');
    const evidence = await readIndexedEvidence({ connection, state:await store.read(), programId, day, now:now(), qaMints:schedule.mints });
    if (evidence.complete === false) return evidence;
    const ledger = await rewardStore.read();
    const excluded = prior?.snapshot.evidence.excludedCollectionSignatures || evidence.collections
      .filter(row=>ledger.dailyBonusAssignments?.[row.signature] && ledger.dailyBonusAssignments[row.signature] !== prior?.snapshot.hash)
      .map(row=>row.signature);
    return { ...evidence, ...(excluded.length ? { excludedCollectionSignatures:excluded } : {}) };
  }
  async function capture(day = latestBonusDay(now(),schedule)) {
    await ready();
    const prior = (await rewardStore.read()).dailyBonusSnapshots?.[day];
    const evidence = await evidenceFor(day,prior);
    if (evidence.complete === false) {
      const progress = { status:'indexing', day, reason:evidence.reason, progress:evidence.progress,
        checkedAt:new Date(now() * 1000).toISOString() };
      await rewardStore.transaction(state => { state.dailyBonusProgress ||= {}; state.dailyBonusProgress[day] = progress; });
      return progress;
    }
    const snapshot = buildDailyBonusSnapshot({ day, ...evidence, now:now() });
    const result = await rewardStore.transaction(state => {
      state.dailyBonusSnapshots ||= {};
      const prior = state.dailyBonusSnapshots[day];
      if (state.dailyBonusProgress) delete state.dailyBonusProgress[day];
      if (prior && !isDeepStrictEqual(prior.snapshot, snapshot)) {
        prior.status = 'reconciliation-required';
        prior.reason = 'Finalized evidence changed after the immutable daily snapshot.';
        return null;
      }
      if (prior) { prior.evidenceCoverageVersion = 1; return structuredClone(prior); }
      return state.dailyBonusSnapshots[day] = { snapshot, status:'snapshotted',
        evidenceCoverageVersion:1, createdAt:new Date(now() * 1000).toISOString(), payouts:{} };
    });
    if (!result) throw new Error('Daily bonus evidence changed; reconcile before further payouts.');
    return result;
  }
  async function execute(day = latestBonusDay(now(),schedule)) {
    if (!payoutEnabled) throw new Error('Daily bonus payouts are not activated.');
    if (running) throw new Error('A daily bonus execution is already running.');
    running = true;
    try {
      await ready();
      const record = (await rewardStore.read()).dailyBonusSnapshots?.[day] || await capture(day);
      if (record.status === 'indexing') return await status();
      if (record.status === 'reconciliation-required') throw new Error(record.reason);
      const { snapshot } = record;
      const window = bonusWindow(day,now());
      if (snapshot.day !== day || snapshot.start !== window.start || snapshot.end !== window.end) throw new Error('Daily bonus requires a completed verified window.');
      const { hash, ...frozen } = snapshot;
      if (snapshot.version !== 1 || hash !== bonusHash(frozen)) throw new Error('Saved daily bonus snapshot evidence changed.');
      for (const source of snapshot.sources) {
        const prior = (await rewardStore.read()).dailyBonusSnapshots[day].payouts[source.collectionSignature];
        if (prior?.status === 'paid') continue;
        const manifest = dailyBonusManifest(snapshot, source);
        if (!manifest) continue;
        const app = await store.read(), launch = app.launches?.[source.mint];
        const funded = app.v3CommunityFunding?.[source.collectionSignature];
        if (funded?.status !== 'finalized') continue;
        const vault = rewardAddresses({ programId, authority:authority.publicKey, mint:source.mint }).vault.toBase58();
        if (funded.balanceDeltaVerified !== true || funded.amount !== source.amountLamports
          || funded.mint !== source.mint || funded.recipient !== vault
          || launch?.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version !== 1)
          throw new Error('Daily bonus source conflicts with its finalized community funding.');
        if (manifest.leaves.some(row => row.recipient === vault)) throw new Error('The reward vault cannot receive a daily bonus.');
        const policy = await verifyPolicy({ connection, programId, mint:source.mint,
          creator:launch.creatorWallet, initialAuthority:launch.pumpFeeRoute.initialAuthority,
          split:launch.pumpFeeRoute.protocolSplit });
        if (!policy.verified) throw new Error('Daily bonus source mint policy is not verified.');
        const proof = await loadFunding({ connection, signature:funded.signature, programId, mint:source.mint,
          authority:authority.publicKey, creator:launch.creatorWallet,
          initialAuthority:launch.pumpFeeRoute.initialAuthority,
          withdrawalId:v3DisbursementId('community', source.settlementSignature),
          category:5, amount:source.amountLamports, recipient:vault,
          split:launch.pumpFeeRoute.protocolSplit, protectedPolicy:policy.protectedPolicy === true,
          beneficiary:7, holderAmount:0n });
        if (!proof || proof.balanceDeltaVerified !== true || proof.signature !== funded.signature
          || proof.mint !== source.mint || proof.category !== 5
          || proof.amount !== source.amountLamports || proof.recipient !== vault)
          throw new Error('Daily bonus source lacks exact finalized community funding proof.');
        const plan = { mint:source.mint, cutoffAt:snapshot.end, payoutAt:snapshot.end, manifest };
        await rewardStore.transaction(state => {
          state.dailyBonusAssignments ||= {};
          const assigned = state.dailyBonusAssignments[source.collectionSignature];
          if (assigned && assigned !== snapshot.hash) throw new Error('Daily bonus source was already assigned to another snapshot.');
          state.dailyBonusAssignments[source.collectionSignature] = snapshot.hash;
          const row = state.dailyBonusSnapshots[day];
          if (row.status === 'reconciliation-required' || row.snapshot.hash !== snapshot.hash)
            throw new Error(row.reason || 'The reviewed daily bonus snapshot changed.');
          const saved = row.payouts[source.collectionSignature];
          if (saved && !isDeepStrictEqual(saved.manifest, manifest)) throw new Error('Daily bonus payout manifest is immutable.');
          row.payouts[source.collectionSignature] ||= { manifest, status:'prepared', payments:{}, fundingSignature:funded.signature };
        });
        const cycle = await chain.ensureCycle(plan);
        await rewardStore.transaction(state => Object.assign(state.dailyBonusSnapshots[day].payouts[source.collectionSignature],
          { status:'distributing', cycle:cycle.address, ...(cycle.signature ? { cycleSignature:cycle.signature } : {}) }));
        for (const leaf of manifest.leaves) {
          const current = (await rewardStore.read()).dailyBonusSnapshots[day];
          if (current.status !== 'snapshotted' || current.snapshot.hash !== snapshot.hash)
            throw new Error('Daily bonus snapshot changed or was paused before payment.');
          const saved = current.payouts[source.collectionSignature].payments[leaf.recipient];
          if (saved?.finalized === true && saved.balanceDeltaVerified === true) continue;
          const payment = await chain.submitLeaf(plan, leaf);
          if (payment.finalized !== true || payment.balanceDeltaVerified !== true)
            throw new Error('Daily bonus payment lacks finalized account and balance evidence.');
          await rewardStore.transaction(state => {
            state.dailyBonusSnapshots[day].payouts[source.collectionSignature].payments[leaf.recipient] = {
              ...payment, amount:leaf.amount, paidAt:new Date(now() * 1000).toISOString() };
          });
        }
        await rewardStore.transaction(state => {
          state.dailyBonusSnapshots[day].payouts[source.collectionSignature].status = 'paid';
        });
      }
      return await status();
    } finally { running = false; }
  }
  async function status() {
    const state = await rewardStore.read();
    return { cluster, policy:DAILY_BONUS_POLICY, schedule:publicBonusSchedule(schedule), payoutEnabled,
      indexing:Object.values(state.dailyBonusProgress || {}).sort((a,b) => a.day.localeCompare(b.day)), nextCutoffAt:
      new Date((currentBonusStart(now(),schedule) + schedule.periodSeconds) * 1000).toISOString(),
      snapshots:Object.values(state.dailyBonusSnapshots || {}).sort((a, b) => b.snapshot.start - a.snapshot.start)
        .slice(0, 30).map(({ snapshot, status:state, reason, payouts }) => ({ day:snapshot.day,
          cutoffAt:new Date(snapshot.end * 1000).toISOString(), hash:snapshot.hash, status:state, reason,
          rankings:snapshot.rankings, allocatedLamports:String(snapshot.sources.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n)),
          retainedLamports:String(snapshot.sources.reduce((sum, row) => sum + BigInt(row.retainedLamports), 0n)),
          sources:snapshot.sources.map(source => ({ mint:source.mint, collectionSignature:source.collectionSignature,
            status:payouts[source.collectionSignature]?.status || (source.allocations.length ? 'awaiting-verified-community-funding' : 'no-eligible-winners'),
            payments:payouts[source.collectionSignature]?.payments || {} })) })) };
  }
  async function reviewReconciliation(day, expectedHash) {
    if (!/^[a-f0-9]{64}$/.test(String(expectedHash))) throw new Error('The reviewed snapshot hash is required.');
    await ready();
    const prior = (await rewardStore.read()).dailyBonusSnapshots?.[day];
    if (!prior || prior.snapshot.hash !== expectedHash) throw new Error('The selected snapshot changed; review its current hash.');
    const { hash, ...frozen } = prior.snapshot;
    if (hash !== bonusHash(frozen)) throw new Error('Saved daily bonus snapshot evidence changed.');
    if (Object.keys(prior.payouts || {}).length) throw new Error('A prepared or paid daily bonus cannot be replaced.');
    const evidence = await evidenceFor(day,prior);
    if (evidence.complete === false) throw new Error(evidence.reason);
    const next = buildDailyBonusSnapshot({ day, ...evidence, now:now() });
    for (const source of [...prior.snapshot.sources, ...next.sources]) {
      const manifest = dailyBonusManifest(prior.snapshot, source);
      if (!manifest) continue;
      const cycle = rewardAddresses({ programId, authority:authority.publicKey, mint:source.mint,
        cycleId:manifest.cycleId }).cycle;
      if (await connection.getAccountInfo(cycle, 'finalized')) throw new Error('An on-chain daily bonus cycle already exists; preserve its manifest.');
    }
    return { prior, next };
  }
  async function reconcile(day, { expectedHash, expectedNewHash, reason, actor = 'authorized-operator' } = {}) {
    if (!/^[a-f0-9]{64}$/.test(String(expectedNewHash)) || typeof reason !== 'string' || reason.trim().length < 10)
      throw new Error('Reconciliation requires the reviewed replacement hash and an audit reason.');
    const { next } = await reviewReconciliation(day, expectedHash);
    if (next.hash !== expectedNewHash) throw new Error('Replacement evidence changed after review; review it again.');
    await rewardStore.transaction(state => {
      const row = state.dailyBonusSnapshots?.[day];
      if (row?.snapshot.hash !== expectedHash || Object.keys(row.payouts || {}).length
        || Object.values(state.dailyBonusAssignments || {}).includes(expectedHash)
        || next.sources.some(source => state.dailyBonusAssignments?.[source.collectionSignature]))
        throw new Error('Daily bonus reconciliation conflicts with reserved or changed evidence.');
      row.revisions ||= [];
      row.revisions.push({ snapshot:row.snapshot, reason:reason.trim().slice(0,500), actor,
        replacedAt:new Date(now() * 1000).toISOString() });
      row.snapshot = next; row.status = 'snapshotted'; row.evidenceCoverageVersion = 1; delete row.reason;
    });
    return await status();
  }
  return { capture, execute, status, reconcile, dashboard,
    async review(day, expectedHash) {
      const { prior, next } = await reviewReconciliation(day, expectedHash);
      return { day, expectedHash:prior.snapshot.hash, expectedNewHash:next.hash,
        rankings:next.rankings, sources:next.sources.length, previousSources:prior.snapshot.sources.length };
    } };
}
