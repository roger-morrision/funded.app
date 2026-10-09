import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setImmediate as settle } from 'node:timers/promises';
import { loadServerEnvironment } from '../server/environment.mjs';
import { startShareVisitCleanup, startCommunityClaimIndex } from '../server/background-maintenance.mjs';

test('startup preserves environment precedence, empty overrides, and local parsing', () => {
  const env = { PRESENT: 'existing', PRESENT_FILE: 'unused', EMPTY: '', EMPTY_FILE: 'unused', SECRET_FILE: 'secret' };
  const reads = [];
  loadServerEnvironment({ env, cwd: 'fixture', readFile(path, encoding) {
    reads.push(path);
    assert.equal(encoding, 'utf8');
    if (path === 'secret') return '  secret value\n';
    assert.equal(path, resolve('fixture', '.env.local'));
    return '# comment\r\nPRESENT=local\nEMPTY=local\nSECRET=local\nQUOTED="hello world"\nSINGLE=\'text\'\nNUMBER=12\nBROKEN LINE\nLATER_FILE=not-read\n';
  } });
  assert.deepEqual(reads, ['secret', resolve('fixture', '.env.local')]);
  assert.equal(env.PRESENT, 'existing');
  assert.equal(env.EMPTY, '');
  assert.equal(env.SECRET, 'secret value');
  assert.equal(env.QUOTED, 'hello world');
  assert.equal(env.SINGLE, 'text');
  assert.equal(env.NUMBER, '12');
  assert.equal(env.LATER, undefined);
});

test('startup skip prevents all file access; only missing files are tolerated', () => {
  loadServerEnvironment({ env: { FUNDED_SKIP_LOCAL_ENV: 'true', SECRET_FILE: 'unused' },
    readFile() { assert.fail('skip must not read files'); } });
  const env = { SECRET_FILE: 'missing' };
  loadServerEnvironment({ env, readFile() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  assert.equal(env.SECRET, undefined);
  for (const fixture of [{ SECRET_FILE: 'restricted' }, {}]) {
    const denied = Object.assign(new Error('access denied'), { code: 'EACCES' });
    assert.throws(() => loadServerEnvironment({ env: fixture, readFile() { throw denied; } }), error => error === denied);
  }
});

function timers() {
  const calls = [];
  const schedule = (callback, delay) => {
    const timer = { callback, delay, unrefed: false, unref() { this.unrefed = true; } };
    calls.push(timer);
    return timer;
  };
  return { calls, schedule };
}

test('share cleanup checks a clone and prunes the current store before scheduling', async () => {
  const clock = timers();
  const snapshot = { shareVisits: { old: { day: '2000-01-01' } } };
  const current = { shareVisits: { ...snapshot.shareVisits, fresh: { day: new Date().toISOString().slice(0, 10) } } };
  let updates = 0;
  await startShareVisitCleanup({ scheduleInterval: clock.schedule, store: {
    read: async () => snapshot,
    async update(change) {
      assert.ok(snapshot.shareVisits.old, 'read snapshot must remain untouched');
      assert.equal(clock.calls.length, 0, 'first cleanup must finish before scheduling');
      updates++;
      change(current);
    },
  } });
  assert.equal(updates, 1);
  assert.deepEqual(Object.keys(current.shareVisits), ['fresh']);
  assert.equal(clock.calls[0].delay, 86_400_000);
  assert.equal(clock.calls[0].unrefed, true);
});

test('share cleanup avoids empty writes, propagates initial failure, and logs later failures', async () => {
  const clock = timers();
  const failure = new Error('store unavailable');
  const errors = [];
  let fail = false;
  await startShareVisitCleanup({ scheduleInterval: clock.schedule, logger: { error: (...args) => errors.push(args) }, store: {
    async read() { if (fail) throw failure; return {}; },
    async update() { assert.fail('no expired records must not write'); },
  } });
  fail = true;
  clock.calls[0].callback();
  await settle();
  assert.equal(errors[0][1], failure);
  await assert.rejects(startShareVisitCleanup({ store: { read: async () => { throw failure; } },
    scheduleInterval() { assert.fail('initial failure must not schedule cleanup'); } }), error => error === failure);
});

const indexConfig = {
  solanaCluster: 'devnet', solanaRpcUrl: 'https://rpc.example.invalid', fundedTokenMint: 'mint',
  automaticRewardStore: {}, env: {
    FUNDED_REWARD_AUTHORITY: 'authority', FUNDED_FEE_ROUTER_PROGRAM_ID: 'program', FUNDED_REWARD_PROGRAM_DATA_SHA256: 'hash',
  },
};

test('community indexing starts only with the complete supported configuration', () => {
  const disabled = [{ solanaCluster: 'mainnet-beta' }, { fundedTokenMint: '' },
    ...Object.keys(indexConfig.env).map(key => ({ env: { ...indexConfig.env, [key]: '' } }))];
  for (const config of disabled) {
    startCommunityClaimIndex({ ...indexConfig, ...config,
      scheduleTimeout() { assert.fail('disabled index must not schedule'); },
      scheduleInterval() { assert.fail('disabled index must not schedule'); },
      createConnection() { assert.fail('disabled index must not connect'); },
    });
  }
});

test('community indexing retains timing, prevents overlap, and recovers after failure', async () => {
  const clock = timers();
  const errors = [], logs = [], requests = [];
  let complete;
  startCommunityClaimIndex({ ...indexConfig,
    scheduleTimeout: clock.schedule, scheduleInterval: clock.schedule,
    createConnection: url => ({ url }),
    logger: { error: value => errors.push(JSON.parse(value)), log: value => logs.push(JSON.parse(value)) },
    indexClaims: args => { requests.push(args); return new Promise((resolve, reject) => { complete = { resolve, reject }; }); },
  });
  assert.deepEqual(clock.calls.map(timer => [timer.delay, timer.unrefed]), [[5_000, true], [180_000, true]]);
  clock.calls[0].callback();
  clock.calls[1].callback();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { connection: { url: indexConfig.solanaRpcUrl }, ledger: indexConfig.automaticRewardStore,
    programId: 'program', authority: 'authority', eligibilityMint: 'mint', expectedProgramDataSha256: 'hash' });
  complete.reject(new Error('x'.repeat(200)));
  await settle();
  assert.equal(errors[0].event, 'community_claim_index_failed');
  assert.equal(errors[0].reason.length, 180);
  clock.calls[1].callback();
  assert.equal(requests.length, 2);
  complete.resolve({ drops: [1], payments: [1, 2], indexedAt: 'now' });
  await settle();
  assert.deepEqual(logs, [{ event: 'community_claim_indexed', drops: 1, claims: 2, indexedAt: 'now' }]);
  clock.calls[1].callback();
  assert.equal(requests.length, 3);
  complete.resolve({ drops: [], payments: [], indexedAt: 'later' });
  await settle();
});
