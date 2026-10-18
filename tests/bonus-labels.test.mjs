import test from 'node:test';
import assert from 'node:assert/strict';
import {bonusSnapshotLabel,bonusVerificationLabel} from '../src/features/fees/bonus-labels.js';

test('snapshot labels retain UTC dates while converting QA identifiers to five-minute windows',()=>{
  assert.equal(bonusSnapshotLabel('2026-10-18'),'2026-10-18 · UTC day');
  for(const suffix of ['', '@abcdef012345'])assert.equal(bonusSnapshotLabel('qa5m:2026-10-18T16:25:00Z'+suffix),'2026-10-18 · 16:25–16:30 UTC · QA');
  assert.equal(bonusSnapshotLabel('qa5m:2026-10-18T23:55:00Z'),'2026-10-18 · 23:55–2026-10-19 00:00 UTC · QA');
});

test('invalid dates and non-five-minute QA windows remain unavailable',()=>{
  for(const value of [null,'private-internal-id','2026-02-30','qa5m:2026-02-30T16:25:00Z','qa5m:2026-10-18T16:26:00Z','qa5m:2026-10-18T16:25:59Z','qa5m:2026-10-18T16:25:00Z@wrong'])
    assert.equal(bonusSnapshotLabel(value),'Snapshot time unavailable');
});

test('payout copy distinguishes disabled gates, blocked verification and enabled operation',()=>{
  const enabled={snapshotEnabled:true,payoutEnabled:true,worker:{status:'active'}};
  assert.match(bonusVerificationLabel(enabled),/enabled.*requires verified funding/);
  assert.match(bonusVerificationLabel({...enabled,snapshotEnabled:false}),/snapshots are not enabled/);
  assert.match(bonusVerificationLabel({...enabled,payoutEnabled:false}),/payouts are not enabled/);
  for(const status of ['blocked','degraded','unavailable'])assert.match(bonusVerificationLabel({...enabled,worker:{status}}),/verification is delayed/);
  assert.match(bonusVerificationLabel({...enabled,worker:{status:'indexing'}}),/being checked/);
  assert.match(bonusVerificationLabel({worker:{status:'active'}}),/readiness is unavailable/);
});
