import { isDeepStrictEqual } from 'node:util';
import { DAILY_BONUS_POLICY } from '../config/daily-bonus.js';
import { verifyMintPolicyV3Account } from '../mint-router-v3.js';
import { createAutomaticRewardChain, rewardAddresses } from './automatic-reward-chain.mjs';
import { buildDailyBonusSnapshot, dailyBonusManifest, latestBonusDay } from './daily-bonus.mjs';
import { readDailyBonusEvidence } from './daily-bonus-evidence.mjs';
import { loadFinalizedV3RewardFunding } from './v3-reward-funding-proof.mjs';
import { v3DisbursementId } from './v3-disbursement-id.mjs';

export function createDailyBonusService({ store, rewardStore, connection, programId, authority,
  expectedProgramDataSha256, cluster, payoutEnabled = false, readEvidence = readDailyBonusEvidence,
  chainFactory = createAutomaticRewardChain, loadFunding = loadFinalizedV3RewardFunding,
  verifyPolicy = verifyMintPolicyV3Account, now = () => Math.floor(Date.now() / 1000) }) {
  if (cluster !== 'devnet') throw new Error('Daily bonus execution is available only on Devnet.');
  const chain = chainFactory({ connection, programId, authority, expectedProgramDataSha256 });
  let running = false;
  const ready = async () => {
    if (!(await chain.readiness()).constrainedPayouts) throw new Error('Daily bonus requires the reviewed V3 program and authority.');
  };
  async function capture(day = latestBonusDay(now())) {
    await ready();
    const evidence = await readEvidence({ connection, state:await store.read(), programId, day, now:now() });
    const snapshot = buildDailyBonusSnapshot({ day, ...evidence, now:now() });
    const result = await rewardStore.transaction(state => {
      state.dailyBonusSnapshots ||= {};
      const prior = state.dailyBonusSnapshots[day];
      if (prior && !isDeepStrictEqual(prior.snapshot, snapshot)) {
        prior.status = 'reconciliation-required';
        prior.reason = 'Finalized evidence changed after the immutable daily snapshot.';
        return null;
      }
      if (prior) return structuredClone(prior);
      return state.dailyBonusSnapshots[day] = { snapshot, status:'snapshotted',
        createdAt:new Date(now() * 1000).toISOString(), payouts:{} };
    });
    if (!result) throw new Error('Daily bonus evidence changed; reconcile before further payouts.');
    return result;
  }
  async function execute(day = latestBonusDay(now())) {
    if (!payoutEnabled) throw new Error('Daily bonus payouts are not activated.');
    if (running) throw new Error('A daily bonus execution is already running.');
    running = true;
    try {
      const record = await capture(day);
      if (record.status === 'reconciliation-required') throw new Error(record.reason);
      const { snapshot } = record;
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
          if (row.status === 'reconciliation-required') throw new Error(row.reason);
          const saved = row.payouts[source.collectionSignature];
          if (saved && !isDeepStrictEqual(saved.manifest, manifest)) throw new Error('Daily bonus payout manifest is immutable.');
          row.payouts[source.collectionSignature] ||= { manifest, status:'prepared', payments:{}, fundingSignature:funded.signature };
        });
        const cycle = await chain.ensureCycle(plan);
        await rewardStore.transaction(state => Object.assign(state.dailyBonusSnapshots[day].payouts[source.collectionSignature],
          { status:'distributing', cycle:cycle.address, ...(cycle.signature ? { cycleSignature:cycle.signature } : {}) }));
        for (const leaf of manifest.leaves) {
          const saved = (await rewardStore.read()).dailyBonusSnapshots[day].payouts[source.collectionSignature].payments[leaf.recipient];
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
    return { cluster, policy:DAILY_BONUS_POLICY, payoutEnabled, nextCutoffAt:
      new Date((Math.floor(now() / 86_400) + 1) * 86_400_000).toISOString(),
      snapshots:Object.values(state.dailyBonusSnapshots || {}).sort((a, b) => b.snapshot.start - a.snapshot.start)
        .slice(0, 30).map(({ snapshot, status:state, reason, payouts }) => ({ day:snapshot.day,
          cutoffAt:new Date(snapshot.end * 1000).toISOString(), hash:snapshot.hash, status:state, reason,
          rankings:snapshot.rankings, allocatedLamports:String(snapshot.sources.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n)),
          retainedLamports:String(snapshot.sources.reduce((sum, row) => sum + BigInt(row.retainedLamports), 0n)),
          sources:snapshot.sources.map(source => ({ mint:source.mint, collectionSignature:source.collectionSignature,
            status:payouts[source.collectionSignature]?.status || (source.allocations.length ? 'awaiting-verified-community-funding' : 'no-eligible-winners'),
            payments:payouts[source.collectionSignature]?.payments || {} })) })) };
  }
  return { capture, execute, status };
}
