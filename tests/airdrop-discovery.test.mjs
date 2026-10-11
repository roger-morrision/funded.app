import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryPage, holderRewardGroups, isOnCurveAirdrop } from '../src/features/rewards/airdrop-discovery-model.js';

test('on-curve filter requires observed curve state, excluding unknown and published claims', () => {
  assert.equal(isOnCurveAirdrop({}, { complete:false }), true);
  for (const market of [null, {}, { complete:true }, { complete:false, migrated:true }]) assert.equal(isOnCurveAirdrop({}, market), false);
  assert.equal(isOnCurveAirdrop({ claimPublished:true }, { complete:false }), false);
});
test('directory search matches mint, name and ticker and clamps pagination after data changes', () => {
  const rows = Array.from({ length:23 }, (_,i) => ({ mint:`mint-${i}`, name:`Project ${i}`, symbol:`T${i}` }));
  assert.equal(directoryPage(rows, '', 2).rows.length, 10);
  assert.equal(directoryPage(rows, '', 3).range, '21–23 of 23');
  for (const query of ['mint-22','PROJECT 22',' t22 ']) assert.equal(directoryPage(rows,query,5).rows[0].mint,'mint-22');
  assert.equal(directoryPage(rows,'missing',5).page,1);
});
test('distributed requires positive confirmed SOL and recipients, not migration or an allocation', () => {
  const tokens = [
    { mint:'a',holderSharePercent:30,holderPaidLamports:'0',holderPaidWallets:0,totals:{holder:'1000'},migrated:true },
    { mint:'b',holderSharePercent:30,holderPaidLamports:'100',holderPaidWallets:2 },
    { mint:'c',holderSharePercent:0,holderPaidLamports:'100',holderPaidWallets:2 },
    { mint:'d',holderSharePercent:30,holderPaidLamports:'invalid',holderPaidWallets:2 },
  ];
  const groups=holderRewardGroups({ evidence:{status:'partial'},tokens });
  assert.deepEqual(groups.distributed.map(row=>row.mint),['b']);
  assert.deepEqual(groups.upcoming.map(row=>row.mint),['a','d']);
  assert.equal(groups.partial,true);
  assert.equal(holderRewardGroups({evidence:{status:'unavailable'},tokens}).available,false);
  assert.equal(holderRewardGroups({evidence:{status:'unavailable'},tokens}).distributed.length,0);
});
