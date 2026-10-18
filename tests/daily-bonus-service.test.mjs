import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createDailyBonusService } from '../server/daily-bonus-service.mjs';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';

const keys = Array.from({ length:8 }, (_, n) => Keypair.fromSeed(new Uint8Array(32).fill(n + 40)));
const addresses = keys.map(row => row.publicKey.toBase58());
const start = Date.parse('2026-10-17T00:00:00Z') / 1000;
const memory = data => ({ data, async read() { return structuredClone(this.data); },
  async transaction(fn) { return fn(this.data); } });
function setup() {
  const programId = addresses[0], authority = keys[1], mint = addresses[2];
  const vault = rewardAddresses({ programId, authority:authority.publicKey, mint }).vault.toBase58();
  const app = memory({ launches:{ [mint]:{ creatorWallet:addresses[3], pumpFeeRoute:{ initialAuthority:addresses[1] },
    feeDistribution:{ fixedFunded:{ communityRewards:{ dailyBonus:{ version:1 } } } } } },
    v3CommunityFunding:{ collection:{ status:'finalized', balanceDeltaVerified:true, mint,
      recipient:vault, amount:'3000', signature:'funding' } } });
  const store = { read:() => app.read() }, rewardStore = memory({});
  const evidence = { coverage:[{ mint, complete:true }], collections:[{ signature:'collection',
    settlementSignature:'settlement', mint, creator:addresses[3], referrer:addresses[4],
    blockTime:start + 1, finalized:true, amountLamports:'75000', communityLamports:'3000', dailyBonusVersion:1 }],
    trades:[{ signature:'trade', logIndex:1, mint, wallet:addresses[5], blockTime:start + 2,
      finalized:true, amountLamports:'5000' }] };
  let cycles = 0, payments = 0;
  const connection = { getAccountInfo:async () => null };
  const service = createDailyBonusService({ store, rewardStore, connection, programId, authority,
    cluster:'devnet', payoutEnabled:true, now:() => start + 86_400,
    readEvidence:async () => structuredClone(evidence), verifyPolicy:async () => ({ verified:true, protectedPolicy:true }),
    loadFunding:async () => ({ signature:'funding', mint, category:5, amount:'3000', recipient:vault, balanceDeltaVerified:true }),
    chainFactory:() => ({ readiness:async () => ({ constrainedPayouts:true }),
      ensureCycle:async () => { cycles++; return { address:addresses[6], signature:'cycle' }; },
      submitLeaf:async (_, leaf) => { payments++; return { signature:`paid-${leaf.index}`, payment:addresses[7], finalized:true, balanceDeltaVerified:true }; } }) });
  return { service, app, rewardStore, evidence, mint, connection, counts:() => ({ cycles, payments }) };
}
test('funded daily awards use frozen manifests and cannot replay on repeated execution', async () => {
  const f = setup(); await f.service.execute('2026-10-17'); await f.service.execute('2026-10-17');
  assert.deepEqual(f.counts(), { cycles:1, payments:3 });
  const status = await f.service.status();
  assert.equal(status.snapshots[0].sources[0].status, 'paid');
  assert.equal(status.snapshots[0].retainedLamports, '1500');
});
test('missing funding defers payouts; conflicting funding cannot spend another pool', async () => {
  const f = setup(), source = f.app.data.v3CommunityFunding.collection;
  delete f.app.data.v3CommunityFunding.collection;
  await f.service.execute('2026-10-17'); assert.deepEqual(f.counts(), { cycles:0, payments:0 });
  f.app.data.v3CommunityFunding.collection = { ...source, amount:'4000' };
  await assert.rejects(f.service.execute('2026-10-17'), /conflicts/);
  assert.deepEqual(f.counts(), { cycles:0, payments:0 });
});
test('late or changed evidence preserves the original snapshot and blocks further payout', async () => {
  const f = setup(), before = await f.service.capture('2026-10-17');
  f.evidence.trades[0].amountLamports = '9999';
  await assert.rejects(f.service.capture('2026-10-17'), /evidence changed/);
  const after = f.rewardStore.data.dailyBonusSnapshots['2026-10-17'];
  assert.equal(after.snapshot.hash, before.snapshot.hash);
  assert.equal(after.status, 'reconciliation-required');
  assert.deepEqual(f.counts(), { cycles:0, payments:0 });
});

test('published payouts use immutable captured evidence without rescanning later history', async () => {
  const f = setup(); await f.service.capture('2026-10-17');
  f.evidence.trades = [];
  await f.service.execute('2026-10-17');
  assert.equal(f.counts().payments,3);
});
test('explicit audited reconciliation can replace only an unreserved snapshot and retains the original', async () => {
  const f = setup(), before = await f.service.capture('2026-10-17');
  const beforeHash=before.snapshot.hash;
  f.evidence.trades[0].amountLamports = '9999';
  await assert.rejects(f.service.capture('2026-10-17'), /evidence changed/);
  const reviewed=await f.service.review('2026-10-17',beforeHash);
  await f.service.reconcile('2026-10-17',{...reviewed,reason:'Indexer completed its missing finalized evidence.',actor:'qa-admin'});
  const saved=f.rewardStore.data.dailyBonusSnapshots['2026-10-17'];
  assert.equal(saved.status,'snapshotted');assert.notEqual(saved.snapshot.hash,beforeHash);
  assert.equal(saved.revisions[0].snapshot.hash,beforeHash);assert.equal(saved.revisions[0].actor,'qa-admin');
  await f.service.execute('2026-10-17');
  await assert.rejects(f.service.reconcile('2026-10-17',{expectedHash:saved.snapshot.hash,expectedNewHash:'a'.repeat(64),reason:'Cannot change a reserved manifest.'}), /prepared or paid/);
});
test('reconciliation refuses existing on-chain cycles and stale review hashes', async () => {
  const f=setup(), before=await f.service.capture('2026-10-17');
  await assert.rejects(f.service.reconcile('2026-10-17',{expectedHash:'a'.repeat(64),expectedNewHash:'b'.repeat(64),reason:'Stale operator review hash.'}), /snapshot changed/);
  f.connection.getAccountInfo=async()=>({owner:'existing-cycle'});
  await assert.rejects(f.service.reconcile('2026-10-17',{expectedHash:before.snapshot.hash,expectedNewHash:'b'.repeat(64),reason:'A cycle is already reserved.'}), /on-chain daily bonus cycle/);
  assert.deepEqual(f.counts(),{cycles:0,payments:0});
});

test('a modified saved snapshot cannot reuse its original hash to change recipients', async () => {
  const f = setup(); await f.service.capture('2026-10-17');
  f.rewardStore.data.dailyBonusSnapshots['2026-10-17'].snapshot.sources[0].allocations[0].amount = '999999';
  await assert.rejects(f.service.execute('2026-10-17'), /evidence changed/);
  assert.deepEqual(f.counts(), { cycles:0, payments:0 });
});
