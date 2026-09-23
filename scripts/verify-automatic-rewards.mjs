import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdingWeights, allocateHolderPool, distributionClock, countdownText } from '../automatic-rewards.js';
import { createAutomaticRewardWorker, automaticRewardStatus } from '../server/automatic-rewards.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { buildRewardManifest, createRewardCycleId, verifyRewardProof } from '../reward-merkle.js';
import { createHolderHistoryIndexer, snapshotsForPeriod } from '../server/holder-history-indexer.mjs';
import { createRewardScheduler } from '../server/reward-scheduler.mjs';
import { estimateBuyPriceImpactPercent, validateBuyAndDistributePolicy } from '../server/buy-and-distribute.mjs';
import { createRewardFundingProcessor } from '../server/reward-funding-processor.mjs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const snapshots = [
  { at: 0, accounts: [{ account:'a1', wallet:'a', balance:'50' }, { account:'a2', wallet:'a', balance:'50' }, { account:'vault', wallet:'pool', balance:'999999' }] },
  { at: 90, accounts: [{ account:'a1', wallet:'a', balance:'100' }, { account:'b1', wallet:'b', balance:'100' }] },
  { at: 100, accounts: [] },
];
const history = { start:0, end:100, snapshots, excludedWallets:['pool'], coverage:'complete-finalized' };
const weights = holdingWeights(history);
assert.deepEqual(weights, [{ wallet:'a', weight:'10000' }, { wallet:'b', weight:'1000' }]);
assert.deepEqual(allocateHolderPool('110000000', weights), { allocations:[{ wallet:'a', amountLamports:'100000000' }, { wallet:'b', amountLamports:'10000000' }], remainderLamports:'0' });
assert.equal(allocateHolderPool('1', weights).remainderLamports, '1');
assert.equal(allocateHolderPool('999999999999999999', []).remainderLamports, '999999999999999999');
assert.throws(() => holdingWeights({ ...history, coverage:'partial' }));
assert.throws(() => holdingWeights({ ...history, start:1 }));
assert.throws(() => allocateHolderPool('10', [{ wallet:'a', weight:'1' }, { wallet:'a', weight:'1' }]));
const schedule = { cutoffAt:'2026-09-23T00:00:00Z', payoutAt:'2026-09-23T01:00:00Z', status:'scheduled' };
assert.equal(distributionClock(schedule, Date.parse('2026-09-22T23:59:00Z')).remaining, 60);
assert.equal(distributionClock(schedule, Date.parse(schedule.cutoffAt)).remaining, 3600);
assert.match(distributionClock(schedule, Date.parse(schedule.payoutAt)).label, /Delayed/);
assert.equal(distributionClock(null).remaining, null);
assert.deepEqual(distributionClock({ ...schedule, status:'blocked' }, Date.parse('2026-09-23T00:30:00Z')), { label:'Distribution blocked', remaining:null });
assert.deepEqual(distributionClock({ ...schedule, status:'skipped' }, Date.parse('2026-09-22T23:00:00Z')), { label:'Reward period skipped', remaining:null });
assert.equal(distributionClock({ ...schedule, status:'indexing' }, Date.parse(schedule.cutoffAt)).label, 'Cutoff reached · finalizing holder history');
assert.equal(distributionClock({ ...schedule, status:'prepared' }, Date.parse(schedule.cutoffAt)).label, 'Distribution prepared · payout in');
assert.equal(distributionClock({ ...schedule, cutoffAt:'invalid' }).label, 'Schedule unavailable');
assert.equal(distributionClock({ ...schedule, payoutAt:'2026-09-22T23:00:00Z' }).label, 'Schedule unavailable');
assert.equal(countdownText(-1), '00:00:00');
assert.equal(countdownText(0), '00:00:00');
assert.equal(countdownText(59.9), '00:00:59');
assert.equal(countdownText(60), '00:01:00');
assert.equal(countdownText(3661), '01:01:01');
assert.equal(countdownText(Number.NaN), '—');
assert.equal(countdownText(Number.POSITIVE_INFINITY), '—');
assert.equal(automaticRewardStatus().schedules.length, 0);

const mint = Keypair.generate().publicKey.toBase58(), recipientA = Keypair.generate().publicKey.toBase58(), recipientB = Keypair.generate().publicKey.toBase58();
const cycleId = createRewardCycleId({ mint, kind:'holder', asset:'SOL', periodStart:0, periodEnd:100 });
const manifest = buildRewardManifest({ cycleId, allocations:[{ recipient:recipientA, amount:'9' }, { recipient:recipientB, amount:'4' }] });
for (const leaf of manifest.leaves) assert.equal(verifyRewardProof({ cycleId, asset:'SOL', recipient:leaf.recipient, amount:leaf.amount, index:leaf.index, proof:leaf.proof, root:manifest.root }), true);
assert.equal(verifyRewardProof({ cycleId, asset:'SOL', recipient:recipientA, amount:'8', index:0, proof:manifest.leaves[0].proof, root:manifest.root }), false);
assert.equal(snapshotsForPeriod([{ at:0, slot:1, finalized:true, accounts:[] }, { at:50, slot:2, finalized:true, accounts:[] }, { at:99, slot:3, finalized:true, accounts:[] }], 0, 100, 60).at(-1).at, 100);
assert.throws(() => snapshotsForPeriod([{ at:0, finalized:true, accounts:[] }, { at:99, finalized:true, accounts:[] }], 0, 100, 50));
assert.equal(validateBuyAndDistributePolicy({ enabled:true, budgetLamports:'10', maxBudgetLamports:'10', slippagePercent:1, maxPriceImpactPercent:2 }).valid, true);
assert.equal(validateBuyAndDistributePolicy({ enabled:true, budgetLamports:'11', maxBudgetLamports:'10' }).valid, false);
assert.equal(estimateBuyPriceImpactPercent({ route:'curve', snapshot:{ virtualQuoteReservesSol:30, realQuoteReservesSol:0.01 } }, 0.03), 0.1);
assert.equal(estimateBuyPriceImpactPercent({ route:'graduated-pool', snapshot:{ swapQuoteReservesSol:10, virtualQuoteReservesSol:30 } }, 0.1), 1);

const dir = await mkdtemp(join(tmpdir(), 'funded-auto-rewards-'));
try {
  const file = join(dir, 'ledger.json');
  const store = createAutomaticRewardStore(file);
  const ownerA = Keypair.generate().publicKey, ownerB = Keypair.generate().publicKey;
  const accountA = Keypair.generate().publicKey, accountB = Keypair.generate().publicKey;
  const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(30n, 36);
  const tokenData = (owner, amount) => { const data=Buffer.alloc(165); new PublicKey(mint).toBuffer().copy(data,0); owner.toBuffer().copy(data,32); data.writeBigUInt64LE(BigInt(amount),64); data[108]=1; return data; };
  const indexedSnapshot = await createHolderHistoryIndexer({ connection:{
    rpcEndpoint:'https://indexed.example.invalid',
    getAccountInfo:async()=>({ owner:TOKEN_2022_PROGRAM_ID, data:mintData }), getSlot:async()=>6, getBlockTime:async()=>122,
    getProgramAccounts:async()=>{ throw new Error('excluded from account secondary indexes; this RPC method unavailable for key'); },
    getMultipleAccountsInfo:async addresses=>addresses.map(address=>({ owner:TOKEN_2022_PROGRAM_ID, data:address.equals(accountA)?tokenData(ownerA,20):tokenData(ownerB,10) })),
  }, store, fetchImpl:async()=>({ ok:true, json:async()=>({ result:{ token_accounts:[{ address:accountA.toBase58() }, { address:accountB.toBase58() }] } }) }) }).capture(mint, 99_000);
  assert.equal(indexedSnapshot.source, 'indexed-token-accounts-complete');
  assert.equal(indexedSnapshot.holderCount, 2);
  const fallbackSnapshot = await createHolderHistoryIndexer({ connection:{
    getAccountInfo:async()=>({ owner:TOKEN_2022_PROGRAM_ID, data:mintData }), getSlot:async()=>7, getBlockTime:async()=>123,
    getProgramAccounts:async()=>{ throw new Error('excluded from account secondary indexes; this RPC method unavailable for key'); },
    getTokenLargestAccounts:async()=>({ value:[{ address:accountA, amount:'20' }, { address:accountB, amount:'10' }] }),
    getMultipleAccountsInfo:async()=>[{ data:tokenData(ownerA,20) }, { data:tokenData(ownerB,10) }],
  }, store }).capture(mint, 100_000);
  assert.equal(fallbackSnapshot.source, 'largest-accounts-complete');
  assert.equal(fallbackSnapshot.holderCount, 2);
  const base = { mint:'mint', recipient:'wallet', asset:'SOL', verified:true, status:'accrued' };
  await store.transaction(state => {
    state.obligations = {
      first:{ ...base, id:'first', kind:'holder', amount:'6000000' },
      second:{ ...base, id:'second', kind:'holder', amount:'4000000' },
      referral:{ ...base, id:'referral', kind:'referral', amount:'90000000' },
      x:{ ...base, id:'x', kind:'x', amount:'90000000', identityVerified:false },
      dust:{ ...base, recipient:'small', id:'dust', kind:'holder', amount:'10' },
    };
  });
  let sends = 0, proof = null;
  const chain = { readiness:async()=>({ constrainedPayouts:true }), lookup:async()=>proof, submit:async()=>{ sends++; throw new Error('Timeout after broadcast'); } };
  let worker = createAutomaticRewardWorker({ store, chain });
  await worker.tick(); await worker.sendPrepared();
  assert.equal(sends, 1);
  worker = createAutomaticRewardWorker({ store:createAutomaticRewardStore(file), chain });
  await worker.tick(); await worker.sendPrepared();
  assert.equal(sends, 1, 'Uncertain transfers must not be blindly retried after restart');
  let batch = await store.transaction(state => Object.values(state.batches)[0]);
  proof = { ...batch, finalized:true, balanceDeltaVerified:true, signature:'test-proof', recipient:'wrong-wallet' };
  await worker.tick();
  assert.equal(await store.transaction(state => state.obligations.first.status), 'queued');
  proof = { ...batch, finalized:true, balanceDeltaVerified:true, signature:'test-proof' };
  await worker.tick();
  await store.transaction(state => {
    assert.equal(state.obligations.first.status, 'paid');
    assert.equal(state.obligations.second.status, 'paid');
    assert.equal(state.obligations.referral.status, 'accrued');
    assert.equal(state.obligations.x.status, 'accrued');
    assert.equal(state.obligations.dust.status, 'accrued');
  });
  await assert.rejects(store.transaction(async()=>{ throw new Error('rollback'); }));
  assert.equal(await store.transaction(state => state.obligations.first.status), 'paid');
  assert.equal((await createAutomaticRewardWorker({ store, chain:null }).tick()).status, 'unavailable');

  const schedulerFile = join(dir, 'scheduler.json');
  const schedulerStore = createAutomaticRewardStore(schedulerFile);
  let cycles = 0, payouts = 0;
  const schedulerChain = {
    readiness: async()=>({ constrainedPayouts:true, reasons:[] }),
    ensureCycle: async plan => { cycles++; return { address:`cycle-${plan.id}`, signature:'cycle-signature' }; },
    submitLeaf: async (_plan, leaf) => { payouts++; return { signature:`payment-${leaf.index}`, finalized:true, balanceDeltaVerified:true, payment:`record-${leaf.index}` }; },
  };
  const scheduler = createRewardScheduler({ store:schedulerStore, chain:schedulerChain, indexer:{ capture:async()=>{ throw new Error('not due'); } } });
  await scheduler.register({ mint, asset:'SOL', periodSeconds:3600, sampleIntervalSeconds:1800, payoutDelaySeconds:0, activatedAt:3600, excludedWallets:[] });
  await schedulerStore.transaction(state => { state.holderSnapshots[mint] = [
    { at:3600, slot:10, finalized:true, accounts:[{ account:'a', wallet:recipientA, balance:'3' }] },
    { at:5400, slot:11, finalized:true, accounts:[{ account:'a', wallet:recipientA, balance:'3' }, { account:'b', wallet:recipientB, balance:'1' }] },
    { at:7199, slot:12, finalized:true, accounts:[{ account:'a', wallet:recipientA, balance:'3' }, { account:'b', wallet:recipientB, balance:'1' }] },
  ]; });
  await scheduler.recordFundedPool({ id:'funding-1', mint, asset:'SOL', amount:'10000000', fundingSignature:'funding-signature', balanceDeltaVerified:true, fundedAt:4000 });
  await scheduler.prepare(7200);
  const prepared = await scheduler.status(new Date(7200 * 1000));
  assert.equal(prepared.schedules.find(row => row.periodStart === 3600).status, 'prepared');
  await scheduler.execute(7200);
  const completed = await scheduler.status(new Date(7200 * 1000));
  assert.equal(completed.schedules.find(row => row.periodStart === 3600).status, 'paid');
  assert.equal(cycles, 1); assert.equal(payouts, 2);
  const activationMint = Keypair.generate().publicKey.toBase58();
  await scheduler.register({ mint:activationMint, asset:'SOL', periodSeconds:3600, sampleIntervalSeconds:1800, payoutDelaySeconds:0, activatedAt:4000, excludedWallets:[] });
  await schedulerStore.transaction(state => { state.holderSnapshots[activationMint] = [
    { at:7000, slot:20, finalized:true, accounts:[{ account:'a', wallet:recipientA, balance:'1' }] },
    { at:9000, slot:21, finalized:true, accounts:[{ account:'a', wallet:recipientA, balance:'1' }] },
    { at:10799, slot:22, finalized:true, accounts:[{ account:'a', wallet:recipientA, balance:'1' }] },
  ]; });
  await scheduler.recordFundedPool({ id:'pre-full-period-funding', mint:activationMint, asset:'SOL', amount:'10000000', fundingSignature:'roll-forward-funding', balanceDeltaVerified:true, fundedAt:4100 });
  await scheduler.prepare(10800);
  const activated = await scheduler.status(new Date(10800 * 1000));
  assert.equal(activated.schedules.some(row => row.mint === activationMint && row.periodStart === 3600), false);
  assert.equal(activated.schedules.find(row => row.mint === activationMint && row.periodStart === 7200).status, 'prepared');
  await scheduler.recordDirectFunded({ id:'creator-settlement-1', mint, asset:'SOL', kind:'creator', recipient:recipientA, amount:'7', fundingSignature:'creator-funding', balanceDeltaVerified:true, fundedAt:7201 });
  await scheduler.execute(7201);
  const direct = (await scheduler.status(new Date(7201 * 1000))).schedules.find(row => row.kind === 'creator');
  assert.equal(direct.status, 'paid'); assert.equal(direct.recipientCount, 1);
  assert.equal(cycles, 2); assert.equal(payouts, 3);
  const eligibilityMint = Keypair.generate().publicKey.toBase58();
  await scheduler.recordSnapshotAirdrop({ id:'migration-airdrop-1', mint, eligibilityMint, asset:mint, amount:'100', fundingSignature:'token-vault-funding', balanceDeltaVerified:true, fundedAt:7202, excludedWallets:[recipientB], snapshot:{ mint:eligibilityMint, slot:44, at:7202, finalized:true, coverage:'finalized-sampled-v1', accounts:[{ account:'funded-a', wallet:recipientA, balance:'3' }, { account:'funded-b', wallet:recipientB, balance:'9' }] } });
  await scheduler.execute(7202);
  const airdrop = (await scheduler.status(new Date(7202 * 1000))).schedules.find(row => row.kind === 'community');
  assert.equal(airdrop.status, 'paid'); assert.equal(airdrop.recipientCount, 1); assert.equal(airdrop.totalAmount, '100');
  assert.equal(cycles, 3); assert.equal(payouts, 4);

  const processorStore = createAutomaticRewardStore(join(dir, 'processor.json'));
  const processorScheduler = createRewardScheduler({ store:processorStore, chain:schedulerChain, indexer:{ capture:async()=>null } });
  await processorStore.transaction(state => { state.fundingRequests = {
    creator:{ id:'creator', mint, asset:'SOL', kind:'creator', recipient:recipientA, amount:'5', status:'pending' },
    holders:{ id:'holders', mint, asset:'SOL', kind:'holder', recipient:null, amount:'10000000', status:'pending' },
  }; });
  const fundingProcessor = createRewardFundingProcessor({ store:processorStore, chain:{ readiness:async()=>({ constrainedPayouts:true, reasons:[] }), fundSolVaultFromMintRouter:async request=>({ signature:`fund-${request.fundingId}`, claim:`claim-${request.fundingId}`, balanceDeltaVerified:true }) }, scheduler:processorScheduler });
  assert.deepEqual(await fundingProcessor.processPending(), { status:'processed', pending:2, funded:2 });
  await processorStore.transaction(state => { assert.equal(state.fundingRequests.creator.status, 'funded'); assert.equal(state.fundingRequests.holders.status, 'funded'); assert.equal(state.rewardPools.holders.status, 'available'); assert.equal(state.schedules['direct:creator:creator'].status, 'prepared'); });
} finally { await rm(dir, { recursive:true, force:true }); }
console.log('Automatic reward allocation, Merkle proofs, sampled holder history, durable scheduling, manual referral exclusion, buy policy and finalized-delta gates passed (mocked chain).');
