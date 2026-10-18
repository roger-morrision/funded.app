import test from 'node:test';
import assert from 'node:assert/strict';
import { bonusDashboardHistory, readBonusPool } from '../server/daily-bonus-dashboard.mjs';
import { buildDailyBonusSnapshot } from '../server/daily-bonus.mjs';
import { bonusCountdown, bonusSol } from '../src/features/fees/bonus-dashboard-view.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { PublicKey } from '@solana/web3.js';
import { createDailyBonusRuntime } from '../server/daily-bonus-runtime.mjs';
import { createDailyBonusService } from '../server/daily-bonus-service.mjs';
const wallet = new PublicKey(new Uint8Array(32).fill(2)).toBase58(), mint = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
function saved(day, id = 0) {
  const start = Date.parse(`${day}T00:00:00Z`) / 1000;
  const signature = String(id % 8 + 1).repeat(63) + String(Math.floor(id / 8) + 1);
  const snapshot = buildDailyBonusSnapshot({ day, now:start + 86401,
    collections:[{ signature, settlementSignature:'9'.repeat(64), mint, creator:wallet, referrer:wallet,
      blockTime:start + 1, finalized:true, amountLamports:'10000', communityLamports:'300', dailyBonusVersion:1 }],
    trades:[{ signature, logIndex:0, mint, wallet, blockTime:start + 1, finalized:true, amountLamports:'10000' }],
    coverage:[{ mint, complete:true }] });
  // Only rank 1 exists: 50 of each 100 category lamports, 150 combined.
  return { snapshot, status:'snapshotted', payouts:{ [signature]:{ status:'paid', payments:{ [wallet]:{
    amount:'150', amountReceived:'149', signature, payment:'4'.repeat(31) + String(id % 8 + 1),
    finalized:true, balanceDeltaVerified:true, paidAt:`${day}T01:00:00Z` } } } } };
}
test('category net attribution reconciles a combined payment without triple counting it', () => {
  const result = bonusDashboardHistory({ dailyBonusSnapshots:{ one:saved('2026-10-16') } });
  const receipt = result.history.rows[0];
  assert.equal(result.totalPayments, 1);
  assert.deepEqual(receipt.categoryLamports, { creators:'50', referrals:'50', traders:'49' });
  assert.equal(receipt.receivedLamports, '149');
  assert.equal(result.leaders.creators[0].receivedLamports, '50');
  assert.equal(result.leaders.traders[0].receivedLamports, '49');
});
test('history includes older than 30 days, paginates and filters without limiting all-time leaders', () => {
  const snapshots = Object.fromEntries(Array.from({ length:40 }, (_, id) => {
    const day = new Date(Date.UTC(2026, 8, 1 + id)).toISOString().slice(0, 10);
    const row = saved(day, id);
    // Unique account per source; signatures are unique independently.
    Object.values(row.payouts)[0].payments[wallet].payment = null;
    return [day, row];
  }));
  const result = bonusDashboardHistory({ dailyBonusSnapshots:snapshots }, { category:'creators', page:2 });
  assert.equal(result.totalPayments, 40); assert.equal(result.history.rows.length, 20);
  assert.equal(result.history.pages, 2); assert.equal(result.leaders.creators[0].receivedLamports, '2000');
  assert.equal(result.history.rows.at(-1).day, '2026-09-01');
});
test('missing net, incomplete finality and conflicting source aliases do not inflate rankings', () => {
  const row = saved('2026-10-16'), source = Object.values(row.payouts)[0];
  delete source.payments[wallet].amountReceived;
  let result = bonusDashboardHistory({ dailyBonusSnapshots:{ one:row } });
  assert.equal(result.unavailableReceipts, 1); assert.equal(result.leaders.creators.length, 0);
  source.payments[wallet].finalized = false;
  assert.equal(bonusDashboardHistory({ dailyBonusSnapshots:{ one:row } }).totalPayments, 0);
  const a = saved('2026-10-15'), b = saved('2026-10-16');
  result = bonusDashboardHistory({ dailyBonusSnapshots:{ a, b } });
  assert.equal(result.totalPayments, 1); assert.equal(result.unavailableReceipts, 1);
  assert.equal(result.leaders.creators.length, 0);
});
test('amount display preserves lamports and countdown uses UTC server time, stops at cutoff', () => {
  assert.equal(bonusSol('1'), '0.000000001 SOL'); assert.equal(bonusSol(null), 'Unavailable');
  assert.equal(bonusSol('100000000000000000001'), '100000000000.000000001 SOL');
  assert.equal(bonusCountdown(86400000, 86338000, 0), '00:01:02');
  assert.equal(bonusCountdown(86400000, 86338000, 62001), 'Snapshot processing');
});
test('mutated snapshot awards fail integrity checks instead of publishing recipient totals', () => {
  const row = saved('2026-10-16'); row.snapshot.rankings.creators[0].rank = 2;
  const result = bonusDashboardHistory({ dailyBonusSnapshots:{ row } });
  assert.equal(result.unavailableSnapshots, 1); assert.equal(result.totalPayments, 0);
});
test('pool verifies collection and settlement and excludes old-policy / prior-day collections', async () => {
  const now = Date.parse('2026-10-18T12:00:00Z') / 1000, signature = '5'.repeat(64);
  const state = { launches:{ [mint]:{ mint, onchainVerified:true, cluster:'devnet',
    pumpFeeRoute:{ programId:'program', scope:'per-mint-v3', verified:true },
    feeDistribution:{ fixedFunded:{ communityRewards:{ dailyBonus:{ version:1 } } } } } },
    collections:{ [signature]:{ mint, signature, scope:'per-mint-v3', cluster:'devnet', programId:'program',
      status:'collected', onchainVerified:true, attribution:'mint-verified', collectedLamports:'1000' } },
    v3Settlements:{ [signature]:{ status:'finalized', blockTime:now, settlementSignature:'6'.repeat(64) } } };
  const args = { state, programId:'program', now, connection:{
    getGenesisHash:async () => DEVNET_GENESIS_HASH, getTransaction:async () => ({ blockTime:now - 1 }) },
    verifyCollection:async () => ({ claimId:Buffer.alloc(32) }),
    loadSettlement:async () => ({ categoryLamports:['0','0','0','0','0','100','0'] }) };
  const result = await readBonusPool(args);
  assert.deepEqual(result.categoryLamports, { creators:'34', referrals:'33', traders:'33' });
  assert.equal(result.collections, 1);
  await assert.rejects(readBonusPool({ ...args, loadSettlement:async () => null }), /proof is unavailable/);
  assert.equal((await readBonusPool({ ...args, connection:{ ...args.connection,
    getTransaction:async () => ({ blockTime:now - 86400 }) } })).collections, 0);
  state.launches[mint].feeDistribution.fixedFunded.communityRewards.dailyBonus.version = 0;
  assert.equal((await readBonusPool(args)).collections, 0);
  await assert.rejects(readBonusPool({ ...args, connection:{ getGenesisHash:async () => 'mainnet' } }), /not Devnet/);
});
test('public dashboard route validates category, forwards pagination and exposes worker gates', async () => {
  const calls = [];
  const runtime = createDailyBonusRuntime({ store:{}, rewardStore:{ read:async () => ({ dailyBonusServiceStatus:{ status:'indexing' } }) },
    solanaCluster:'devnet', solanaRpcUrl:'http://127.0.0.1:1', v3AuthorityKeypair:() => ({}),
    env:{ FUNDED_V3_FEE_ROUTER_PROGRAM_ID:'test', FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64), FUNDED_DAILY_BONUS_ENABLED:'true' },
    serviceFactory:() => ({ dashboard:async options => {
      calls.push(options); return bonusDashboardHistory({}, options);
    } }) });
  const invoke = async search => {
    let result; const res = { setHeader() {} };
    await runtime.handle({ method:'GET' }, res, new URL(`https://funded.vip/api/daily-bonus/dashboard${search}`), {
      respond:(_res, code, value) => { result = { code, value }; },
      requireAuthorized:() => { throw new Error('Public reads must not require a signing session.'); } });
    return result;
  };
  const result = await invoke('?category=traders&page=2');
  assert.equal(result.code, 200); assert.deepEqual(calls[0], { category:'traders', page:2 });
  assert.equal(result.value.snapshotEnabled, true); assert.equal(result.value.payoutEnabled, false);
  assert.equal(result.value.worker.status, 'indexing');
  assert.equal((await invoke('?category=invalid')).code, 400);
});
test('slow pool RPC cannot block recorded payout history; failed pool stays unavailable and cached', async () => {
  let calls = 0;
  const ledger = { dailyBonusSnapshots:{ row:saved('2026-10-16') } };
  const service = createDailyBonusService({ cluster:'devnet', store:{ read:async () => ({}) },
    rewardStore:{ read:async () => ledger }, chainFactory:() => ({}), now:() => 1792320000,
    poolTimeoutMs:2, readPool:async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); } });
  const result = await service.dashboard({});
  assert.equal(result.pool.status, 'unavailable'); assert.equal(result.totalPayments, 1);
  assert.equal(result.history.rows[0].receivedLamports, '149');
  await service.dashboard({}); assert.equal(calls, 1);
});
