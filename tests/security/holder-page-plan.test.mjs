import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PublicKey } from '@solana/web3.js';
import { allocateHolderPool, AUTOMATIC_REWARDS } from '../../automatic-rewards.js';
import { verifyRewardProof } from '../../reward-merkle.js';
import { buildHolderPagePlan, assertHolderPagePlan, planDigest } from '../../server/holder-page-plan.mjs';
import { createHolderPageProgress } from '../../server/holder-page-progress.mjs';
import { createAutomaticRewardStore } from '../../server/automatic-reward-store.mjs';

const wallet = index => { const bytes = Buffer.alloc(32, 7); bytes.writeUInt32BE(index, 0); return new PublicKey(bytes).toBase58(); };
const weights = count => Array.from({ length:count }, (_, index) => ({ wallet:wallet(index + 1), weight:String(index % 17 + 1) }));
const make = (asset = 'SOL', overrides = {}) => buildHolderPagePlan({ cycleId:'ab'.repeat(32), asset,
  pool:'1000000007', expiresAt:200, weights:weights(1001), ...overrides });
const receipt = (plan, leaf, overrides = {}) => ({ digest:plan.digest, cycleId:plan.cycleId,
  asset:plan.asset, root:plan.root, index:leaf.index, recipient:leaf.recipient, amount:leaf.amount,
  signature:'fixture-signature-' + leaf.index, finalized:true, balanceDeltaVerified:true, executedAt:101, ...overrides });

async function fixture(t, plan = make()) {
  const dir = await mkdtemp(join(tmpdir(), 'holder-page-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, 'offline-ledger.json');
  const reopen = () => createHolderPageProgress({ store:createAutomaticRewardStore(path), plan });
  const progress = reopen();
  await progress.initialize();
  return { plan, path, progress, reopen };
}
const begin = (progress, index, extra = {}) => progress.begin({ index, attemptId:'attempt-' + index,
  now:100, paused:false, solvent:true, ...extra });

for (const asset of ['SOL', wallet(2000)]) {
  test(`${asset}: 1,001 exact global allocations, stable pages and every proof`, () => {
    const plan = make(asset), reversed = make(asset, { weights:weights(1001).reverse() });
    assert.deepEqual(plan, reversed);
    assert.equal(plan.pages.length, 32);
    assert.equal(plan.pages.at(-1).leaves.length, 9);
    const leaves = plan.pages.flatMap(page => page.leaves);
    assert.equal(leaves.length, 1001);
    assert.equal(new Set(leaves.map(leaf => leaf.recipient)).size, 1001);
    const allocation = allocateHolderPool(plan.pool, weights(1001));
    const expected = new Map(allocation.allocations.map(row => [row.wallet, row.amountLamports]));
    for (const leaf of leaves) {
      assert.equal(leaf.amount, expected.get(leaf.recipient));
      assert(verifyRewardProof({ ...leaf, cycleId:plan.cycleId, asset, root:plan.root }));
    }
    assert.equal(leaves.reduce((sum, leaf) => sum + BigInt(leaf.amount), 0n) + BigInt(plan.retainedDust), BigInt(plan.pool));
    assert.equal(assertHolderPagePlan(JSON.parse(JSON.stringify(plan))).digest, plan.digest);
    assert.equal(AUTOMATIC_REWARDS.maxEligibleHolders, 1000);
  });

  test(`${asset}: persisted restart, duplicate and late page completion account once`, async t => {
    const { plan, path, progress, reopen } = await fixture(t, make(asset));
    await begin(progress, 0);
    const receipts = plan.pages[0].leaves.map(leaf => receipt(plan, leaf));
    await progress.reconcile({ index:0, attemptId:'attempt-0', receipts:receipts.slice(0, 3) });
    const child = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import {readFile} from 'node:fs/promises'; const s=JSON.parse(await readFile(process.argv[1],'utf8')); const r=s.holderPagePlans[process.argv[2]]; console.log(JSON.stringify({status:r.pages[0].status,paid:Object.keys(r.pages[0].paid).length}));`, path, plan.cycleId], { encoding:'utf8' });
    assert.deepEqual(JSON.parse(child), { status:'pending', paid:3 });
    let restarted = reopen();
    await assert.rejects(begin(restarted, 0, { now:300 }), /reconciliation/);
    await restarted.reconcile({ index:0, attemptId:'attempt-0', receipts });
    const paidOnce = (await restarted.status()).paid;
    await restarted.reconcile({ index:0, attemptId:'attempt-0', receipts });
    assert.equal((await restarted.status()).paid, paidOnce);
    assert.equal((await begin(restarted, 0)).status, 'finalized');
    for (const page of plan.pages.slice(1)) {
      await begin(restarted, page.index);
      await restarted.reconcile({ index:page.index, attemptId:'attempt-' + page.index,
        receipts:page.leaves.map(leaf => receipt(plan, leaf)) });
      restarted = reopen();
    }
    const done = await restarted.status();
    assert.equal(done.complete, true);
    assert.equal(done.outstanding, '0');
    assert.equal(BigInt(done.paid) + BigInt(done.retainedDust), BigInt(plan.pool));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).holderPagePlans[plan.cycleId].plan.digest, plan.digest);
  });
}

test('unknown attempts, concurrent workers, pause, solvency and expiry fail closed', async t => {
  const { progress, reopen } = await fixture(t);
  for (const extra of [{ paused:true }, { solvent:false }, { paused:undefined }, { now:200 }, { now:NaN }, { now:-1 }])
    await assert.rejects(begin(progress, 0, extra));
  const results = await Promise.allSettled([begin(progress, 0), begin(reopen(), 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(begin(reopen(), 0, { attemptId:'different', now:999 }), /reconciliation/);
  await assert.rejects(begin(progress, 1, { attemptId:'attempt-0' }), /already used/);
  assert.equal((await progress.status()).paid, '0');
});

test('wrong receipts roll back atomically; stale and conflicting completion cannot overwrite', async t => {
  const { plan, progress, path } = await fixture(t);
  await begin(progress, 0);
  const leaf = plan.pages[0].leaves[0], good = receipt(plan, leaf);
  const invalid = [{ amount:'1' }, { asset:wallet(3000) }, { cycleId:'cc'.repeat(32) },
    { digest:'00'.repeat(32) }, { root:'00'.repeat(32) }, { finalized:false },
    { balanceDeltaVerified:false }, { executedAt:200 }, { executedAt:99 },
    { recipient:wallet(3000) }, { signature:'' }, { index:1000 }];
  for (const change of invalid) {
    const before = await readFile(path, 'utf8');
    await assert.rejects(progress.reconcile({ index:0, attemptId:'attempt-0', receipts:[{ ...good, ...change }] }));
    assert.equal(await readFile(path, 'utf8'), before);
  }
  await assert.rejects(progress.reconcile({ index:0, attemptId:'stale', receipts:[good] }), /stale/);
  await assert.rejects(progress.reconcile({ index:0, attemptId:'attempt-0', receipts:[good, good] }));
  assert.equal((await progress.status()).paid, '0');
  await progress.reconcile({ index:0, attemptId:'attempt-0', receipts:[good] });
  await assert.rejects(progress.reconcile({ index:0, attemptId:'attempt-0', receipts:[{ ...good, signature:'other' }] }), /Conflicting/);
});

test('canonical input, hard bounds, immutable cycles and damaged persisted plans', async t => {
  for (const change of [{ weights:weights(1002) }, { pageSize:33 }, { pageSize:0 },
    { pool:'18446744073709551616' }, { pool:'01' }, { expiresAt:0 },
    { weights:[weights(1)[0], weights(1)[0]] }, { weights:[{ wallet:wallet(1), weight:'0' }] }])
    assert.throws(() => make('SOL', change));
  const { path, plan, progress } = await fixture(t);
  const changed = createHolderPageProgress({ store:createAutomaticRewardStore(path), plan:make('SOL', { pool:'1000000008' }) });
  await assert.rejects(changed.initialize(), /Immutable/);
  const bad = structuredClone(plan);
  bad.pages[0].leaves[0].amount = '1';
  assert.throws(() => assertHolderPagePlan(bad), /integrity/);
  const { digest, ...body } = bad;
  bad.digest = planDigest(body);
  assert.throws(() => assertHolderPagePlan(bad), /accounting/);
  for (const change of [{ zeroAllocationCount:-1 }, { eligibleCount:1002 },
    { payableCount:1002, zeroAllocationCount:-1 }, { version:2 }, { pageSize:33 }]) {
    const { digest:oldDigest, ...changedBody } = { ...plan, ...change };
    assert.throws(() => assertHolderPagePlan({ ...changedBody, digest:planDigest(changedBody) }), /bounded admission/);
  }
  await assert.rejects(begin(progress, -1), /Unknown page/);
});

test('floor rounding retains dust; zero-entitlement holders are counted explicitly', () => {
  const plan = make('SOL', { pool:'1000', weights:[{ wallet:wallet(1), weight:'1' }, { wallet:wallet(2), weight:'1000' }] });
  assert.equal(plan.eligibleCount, 2);
  assert.equal(plan.payableCount, 1);
  assert.equal(plan.zeroAllocationCount, 1);
  assert.equal(plan.allocated, '999');
  assert.equal(plan.retainedDust, '1');
});

test('corrupt persisted payment accounting fails closed after restart', async t => {
  const { plan, path, progress, reopen } = await fixture(t);
  await begin(progress, 0);
  await progress.reconcile({ index:0, attemptId:'attempt-0', receipts:[receipt(plan, plan.pages[0].leaves[0])] });
  await createAutomaticRewardStore(path).transaction(state => {
    const row = state.holderPagePlans[plan.cycleId];
    row.pages[0].paid[0].amount = '18446744073709551615';
  });
  await assert.rejects(reopen().status(), /immutable entitlement/);
  await assert.rejects(begin(reopen(), 1), /immutable entitlement/);
});
