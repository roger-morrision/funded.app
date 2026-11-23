import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {reserveEnvironment, reserveFixture, assertFunded} from './fixtures/airdrop-reserve-fixture.mjs';

test('selected proof cache expires at 30 seconds without a policy change', async t => {
  reserveEnvironment(t); let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now); const f = reserveFixture();
  const initial = await f.selected(), before = f.snapshot(); assertFunded(initial, f.target);
  now += 29_999; assert.deepEqual(await f.selected(), initial); assert.deepEqual(f.snapshot(), before);
  now++; assertFunded(await f.selected(), f.target); assert.equal(f.connections, 2);
});

test('selected proof cache retains the existing 100 mint bound', async t => {
  reserveEnvironment(t); const f = reserveFixture({rows:101});
  for (const row of f.rows) assertFunded(await f.request(row.mint.toBase58()), row);
  assert.equal(f.connections, 101); const before = f.snapshot();
  assertFunded(await f.request(f.rows[100].mint.toBase58()), f.rows[100]); assert.deepEqual(f.snapshot(), before);
  assertFunded(await f.selected(), f.target); assert.equal(f.connections, 102, 'oldest selected entry was evicted');
});

test('completed directory cache keeps precedence over an older selected cache', async t => {
  reserveEnvironment(t); const f = reserveFixture({variant:'partial'});
  assert.equal((await f.selected()).data.reserves[0].status, 'partial');
  f.variant = 'funded'; assertFunded(await f.request(), f.target); const before = f.snapshot();
  assertFunded(await f.selected(), f.target); assert.deepEqual(f.snapshot(), before);
});

for (const oldFirst of [true, false]) test('receipt invalidation isolates old directory and selected work: old finishes ' + (oldFirst ? 'first' : 'last'), {timeout:5000}, async t => {
  reserveEnvironment(t); const f = reserveFixture({variant:'partial'});
  const oldDirectoryGate = f.hold(0), oldSelectedGate = f.hold(1);
  const oldDirectory = f.request(), oldSelected = f.selected();
  const pending = [oldDirectory, oldSelected];
  try {
    await Promise.all([oldDirectoryGate.entered.promise, oldSelectedGate.entered.promise]);
    f.variant = 'funded'; f.bindReceiptRpc(t); // The actual receipt route uses these real parser RPC methods.
    const receipt = await f.recordReceipt(); assert.equal(receipt.data.verified, true);
    const currentSelectedGate = f.hold(3), currentDirectoryGate = f.hold(4);
    const currentSelected = f.selected(), currentDirectory = f.request(); pending.push(currentSelected, currentDirectory);
    await Promise.all([currentSelectedGate.entered.promise, currentDirectoryGate.entered.promise]);
    if (oldFirst) {
      oldSelectedGate.release.resolve(); oldDirectoryGate.release.resolve();
      for (const old of [oldSelected, oldDirectory]) assert.equal((await old).data.reserves[0].status, 'partial');
      const before = f.snapshot(), connections = f.connections;
      let selectedDone = false, directoryDone = false;
      const selectedDuplicate = f.selected().then(value => { selectedDone = true; return value; });
      const directoryDuplicate = f.request().then(value => { directoryDone = true; return value; });
      pending.push(selectedDuplicate, directoryDuplicate); await setImmediate();
      assert.equal(selectedDone, false, 'old selected completion did not refill the new cache');
      assert.equal(directoryDone, false, 'old directory completion did not refill the new cache');
      assert.equal(f.connections, connections, 'old finalizers did not delete newer single-flight work');
      assert.deepEqual(f.snapshot(), before);
    }
    currentSelectedGate.release.resolve(); currentDirectoryGate.release.resolve();
    assertFunded(await currentSelected, f.target); assertFunded(await currentDirectory, f.target);
    if (!oldFirst) {
      oldSelectedGate.release.resolve(); oldDirectoryGate.release.resolve();
      for (const old of [oldSelected, oldDirectory]) assert.equal((await old).data.reserves[0].status, 'partial');
    }
    const before = f.snapshot(); assertFunded(await f.selected(), f.target); assertFunded(await f.request(), f.target);
    assert.deepEqual(f.snapshot(), before, 'stale responses cannot replace current caches');
  } finally { f.releaseAll(); await Promise.allSettled(pending); }
});
