import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotsForPeriod } from '../server/holder-history-indexer.mjs';

const sample = (at, slot = at + 1) => ({ at, slot, finalized:true, accounts:[] });

test('holder periods reject a stale opening sample even when interior samples are fresh', () => {
  assert.throws(() => snapshotsForPeriod([sample(0), sample(210), sample(270)],
    200, 300, 120), /opening.*gap/i);
});

test('a fresh opening sample is clamped to the start without changing its finalized slot', () => {
  const rows = snapshotsForPeriod([sample(198), sample(210), sample(270)], 200, 300, 120);
  assert.deepEqual(rows.map(row => row.at), [200, 210, 270, 300]);
  assert.equal(rows[0].slot, 199);
  assert.equal(rows.at(-1).slot, 271);
});

test('missing opening coverage and long interior gaps remain blocked', () => {
  assert.throws(() => snapshotsForPeriod([sample(210), sample(270)], 200, 300, 120), /cover/);
  assert.throws(() => snapshotsForPeriod([sample(198), sample(210)], 200, 500, 120), /gap/);
});
