// Local-only bounded feasibility baseline. No RPC, signer or production ledger.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PublicKey } from '@solana/web3.js';
import { buildHolderPagePlan } from '../server/holder-page-plan.mjs';
import { createHolderPageProgress } from '../server/holder-page-progress.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';

// Declared before measurements: bounded admission experiment, not release SLOs.
const limits = { maxRecipients:1001, maxPageSize:32, planMs:1000, journalMs:30000,
  peakRssBytes:256 * 1024 * 1024, ledgerBytes:8 * 1024 * 1024 };
const count = Number(process.argv[2]), asset = process.argv[3] || 'SOL';
assert([1000, 1001].includes(count), 'Only declared boundary cohorts are supported.');
const weights = Array.from({ length:count }, (_, index) => {
  const bytes = Buffer.alloc(32, 13); bytes.writeUInt32BE(index, 0);
  return { wallet:new PublicKey(bytes).toBase58(), weight:String(index % 17 + 1) };
});
const dir = await mkdtemp(join(tmpdir(), 'holder-page-measure-'));
try {
  const started = performance.now();
  const plan = buildHolderPagePlan({ cycleId:'de'.repeat(32), asset, weights,
    pool:'1000000007', expiresAt:200 });
  const planMs = performance.now() - started;
  const path = join(dir, 'offline.json'), disk = createAutomaticRewardStore(path);
  let transactions = 0, serializedBytesWritten = 0, serializedBytesRead = 0, reads = 0;
  const store = { async transaction(mutator) {
    try { serializedBytesRead += (await stat(path)).size; reads++; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = await disk.transaction(mutator);
    transactions++; serializedBytesWritten += (await stat(path)).size;
    return result;
  } };
  const journalStart = performance.now();
  const progress = createHolderPageProgress({ store, plan });
  await progress.initialize();
  for (const page of plan.pages) {
    const attemptId = 'offline-' + page.index;
    await progress.begin({ index:page.index, attemptId, now:100, paused:false, solvent:true });
    await progress.reconcile({ index:page.index, attemptId, receipts:page.leaves.map(leaf => ({
      digest:plan.digest, cycleId:plan.cycleId, asset, root:plan.root,
      index:leaf.index, recipient:leaf.recipient, amount:leaf.amount,
      signature:'mocked-' + leaf.index, finalized:true, balanceDeltaVerified:true, executedAt:101,
    })) });
  }
  const result = await progress.status(), journalMs = performance.now() - journalStart;
  assert(result.complete && result.outstanding === '0');
  assert.equal(BigInt(result.paid) + BigInt(result.retainedDust), BigInt(plan.pool));
  const ledgerBytes = (await readFile(path)).length;
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  const withinLimits = planMs <= limits.planMs && journalMs <= limits.journalMs
    && peakRssBytes <= limits.peakRssBytes && ledgerBytes <= limits.ledgerBytes;
  console.log(JSON.stringify({ schemaVersion:1, scope:'local-only mocked receipts; no chain execution',
    node:process.version, platform:process.platform, arch:process.arch, count, asset, limits,
    withinLimits, planMs, journalMs, peakRssBytes, ledgerBytes, pages:plan.pages.length,
    fileTransactions:transactions, fileReadCount:reads, serializedBytesRead, serializedBytesWritten,
    databaseQueries:0, rpcCalls:0, chainTransactions:0,
    projectedCurrentTransportMinimums:{ devnetAtMostFourRecipients:Math.ceil(count / 4),
      mainnetSingleRecipient:count, status:'arithmetic lower bounds; excludes setup, retries and size splits' },
    accounting:{ pool:plan.pool, paid:result.paid, retainedDust:result.retainedDust } }, null, 2));
  if (!withinLimits) process.exitCode = 1;
} finally { await rm(dir, { recursive:true, force:true }); }
