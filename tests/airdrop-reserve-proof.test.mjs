import assert from 'node:assert/strict';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import {reserveEnvironment, reserveFixture, mustComplete, assertFunded} from './fixtures/airdrop-reserve-fixture.mjs';

test('funded selected proof completes independently with D plus S bounded RPC work', {timeout:5000}, async t => {
  reserveEnvironment(t);
  const measure = async selected => {
    const f = reserveFixture({rows:6}), started = performance.now();
    const response = await (selected ? f.selected() : f.request());
    assertFunded(response, f.target);
    return {counts:f.snapshot(), peak:f.peak, ms:performance.now() - started};
  };
  const D = await measure(false), S = await measure(true), f = reserveFixture({rows:6});
  const blocked = f.hold(0, f.rows[1].mint), started = performance.now();
  let directoryDone = false;
  const directory = f.request().then(value => { directoryDone = true; return value; });
  try {
    await blocked.entered.promise;
    const selected = f.selected(), duplicate = f.selected();
    const [first, second] = await mustComplete(Promise.all([selected, duplicate]));
    const selectedMs = performance.now() - started;
    assertFunded(first, f.target); assert.deepEqual(second, first); assert.equal(directoryDone, false);
    const beforeCached = f.snapshot(); assert.deepEqual(await f.selected(), first);
    assert.deepEqual(f.snapshot(), beforeCached, 'cached selected read adds no RPC work');
    blocked.release.resolve(); assertFunded(await directory, f.target);
    const concurrent = f.snapshot();
    for (const method of new Set([...Object.keys(D.counts), ...Object.keys(S.counts), ...Object.keys(concurrent)])) {
      assert.ok((concurrent[method] || 0) <= (D.counts[method] || 0) + (S.counts[method] || 0), method + ' exceeded D + S');
    }
    assert.ok(f.peak <= D.peak + S.peak, 'concurrent peak is bounded by the two independent scopes');
    assert.equal(f.storeReads, 2, 'one directory and one selected verification scope');
    t.diagnostic(JSON.stringify({case:'rpc-budget',D,S,concurrent,peak:f.peak,selectedBeforeDirectoryRelease:true,
      selectedMs,totalMs:performance.now() - started,scope:'Deterministic RPC method counters; timings are not a live SLA.'}));
  } finally { f.releaseAll(); await directory; }
});

test('funded pending duplicates and completed selected cache add zero verification RPCs', {timeout:5000}, async t => {
  reserveEnvironment(t); const f = reserveFixture(), gate = f.hold(0), first = f.selected();
  try {
    await gate.entered.promise; const before = f.snapshot();
    const duplicates = Array.from({length:10}, () => f.selected());
    assert.deepEqual(f.snapshot(), before); assert.equal(f.connections, 1); assert.equal(f.storeReads, 1);
    gate.release.resolve(); const response = await first; assertFunded(response, f.target);
    for (const duplicate of duplicates) assert.deepEqual(await duplicate, response);
    const completed = f.snapshot(); assert.deepEqual(await f.selected(), response); assert.deepEqual(f.snapshot(), completed);
  } finally { f.releaseAll(); await first; }
});

const negatives = [
  ['missing-proof','funding-unverified'], ['no-recorded-proof','funding-unverified'],
  ['rejected-proof','funding-unverified'], ['unfinalized-proof','funding-unverified'],
  ['missing-status','funding-unverified'], ['wrong-transfer-delta','funding-unverified'],
  ['wrong-program','unavailable'], ['non-executable-program','unavailable'],
  ['wrong-programdata-owner','unavailable'], ['wrong-programdata-hash','unavailable'],
  ['wrong-vault-owner','unavailable'],
];
for (const [variant, status] of negatives) test('selected proof retains rejection semantics: ' + variant, async t => {
  reserveEnvironment(t); const f = reserveFixture({variant}), response = await f.selected();
  assert.equal(response.status, 200); const [reserve] = response.data.reserves;
  assert.equal(reserve.status, status); assert.equal(reserve.verified, false);
  assert.equal(reserve.fundingSignature ?? null, null);
  assert.equal(f.active, 0);
});

test('wrong selected RPC genesis returns 503 without reading program or reserve accounts', async t => {
  reserveEnvironment(t); const f = reserveFixture({variant:'wrong-genesis'}), response = await f.selected();
  assert.equal(response.status, 503); assert.equal(response.data.reserves, undefined);
  assert.deepEqual(f.snapshot(), {getGenesisHash:1});
});

test('directory still admits only four row verifications at once', {timeout:5000}, async t => {
  reserveEnvironment(t); const f = reserveFixture({rows:6});
  const gates = f.rows.map(row => f.hold(0, row.mint)), directory = f.request();
  try {
    await Promise.all(gates.slice(0,4).map(gate => gate.entered.promise));
    const mints = new Set(f.rows.map(row => row.mint.toBase58()));
    const started = f.events.filter(event => event.method === 'getAccountInfo' && mints.has(event.address));
    assert.equal(started.length, 4, 'fifth and sixth row cannot start behind held first four');
    f.releaseAll(); const response = await directory;
    assert.equal(response.data.reserves.length, 6);
    for (const row of f.rows) assertFunded(response, row);
    t.diagnostic(JSON.stringify({case:'directory-row-bound',admittedBeforeRelease:started.length,rows:6,peakRpc:f.peak}));
  } finally { f.releaseAll(); await directory; }
});
