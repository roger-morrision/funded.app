import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLaunchPreviewController } from '../src/app/controllers/launch-preview.js';
import { launchEstimateRetry } from '../src/features/launch/estimate-refresh.js';

// Actual controller source, with service dependencies isolated at the module
// boundary. No healthy fee API, quote endpoint, network or signing fixture.
const controllerSource = await readFile(new URL('../src/app/controllers/wallet-metrics.js', import.meta.url), 'utf8');
const { createContext, SourceTextModule, SyntheticModule } = vm;
const boundaryChild = process.argv[2] === '--fqa073-boundary';
const boundaryName = boundaryChild ? process.argv[3] : null;
let selected;
function test(name, run) {
  if (boundaryChild) {
    if (name === boundaryName) { assert.equal(selected, undefined); selected = { name, run }; }
    return;
  }
  return nodeTest(name, () => {
    const env = { ...process.env };
    for (const key of ['NODE_OPTIONS', 'FUNDED_TRACE_APPEND_REVIEW', 'FUNDED_TRACE_APPEND_ROOT', 'NODE_TEST_CONTEXT']) delete env[key];
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url), '--fqa073-boundary', name], {
      env, encoding:'utf8', windowsHide:true, timeout:20000,
    });
    const diagnostics = JSON.stringify({ error:result.error?.message, signal:result.signal, status:result.status, stdout:result.stdout, stderr:result.stderr });
    assert.equal(result.error, undefined, diagnostics); assert.equal(result.signal, null, diagnostics);
    assert.equal(result.status, 0, diagnostics);
    assert.equal(result.stdout.trim(), JSON.stringify({ boundary:name, status:'passed' }), diagnostics);
  });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture({ balance = null, fetchedAt = 12345 } = {}) {
  const fees = deferred(), feesEntered = deferred(), balanceEntered = deferred();
  const reads = [], metrics = [], renders = [], warnings = [];
  const session = { address:'public-unit-wallet', provider:{ publicKey:{ toBase58:() => 'public-unit-wallet' } } };
  let current = session;
  const app = {
    wallet:session.provider, connectedWalletAddress:session.address,
    metricsRequest:0, walletBalanceRequest:0, walletBalanceLamports:balance,
    walletBalanceFetchedAt:fetchedAt, launchCostRefreshTimer:null,
    estimatedLaunchFeeLamports:99, estimatedInitialBuyLamports:10,
    estimatedInitialBuyTokens:20, launchCostReview:{ old:true }, launchEstimateRetry:null,
    feeRouterState:{ verified:false, status:'unavailable' },
    captureWalletSession:() => current,
    isWalletSessionCurrent:s => Boolean(current && current === s && app.wallet === s.provider),
    assertWalletSessionCurrent(s) { if (!app.isWalletSessionCurrent(s)) throw Error('Wallet changed'); },
    async getSolana() { return {}; },
    withRpcRetry:fn => fn(),
    connection:{ getBalance(payer, commitment) {
      const gate = deferred(); reads.push({ payer, commitment, ...gate }); balanceEntered.resolve(); return gate.promise;
    } },
    renderWalletBalance(options = {}) { renders.push({ balance:app.walletBalanceLamports, fetchedAt:app.walletBalanceFetchedAt, ...options }); },
    developerBuyLimitReached:() => false,
    getLaunchBurnPolicy:() => ({ requiresBurn:true }),
    renderLaunchBurnSelection() { app.burnRenders = (app.burnRenders || 0) + 1; },
  };
  const preview = createLaunchPreviewController(app);
  app.setWalletMetrics = options => { metrics.push(structuredClone(options)); preview.setWalletMetrics(options); };
  const context = createContext({ clearTimeout, setTimeout, Date, console:{ warn:(...args) => warnings.push(args) } });
  const dependencies = {
    '../../features/launch/estimate-refresh.js':{ launchEstimateRetry },
    '../../features/fees/service-fees-client.js':{
      refreshServiceFees:() => { feesEntered.resolve(); return fees.promise; },
      quoteLaunchServiceFee:async () => ({}),
    },
    '../../../launch-service-fee.js':{ launchServiceFeeInstructions:() => { throw Error('No launch construction admitted'); } },
  };
  const module = new SourceTextModule(controllerSource, { context, identifier:'actual-wallet-metrics-controller' });
  await module.link(specifier => {
    const exports = dependencies[specifier]; assert.ok(exports, 'Unexpected dependency '+specifier);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const controller = module.namespace.createWalletMetricsController(app);
  return { app, controller, preview, fees, feesEntered, balanceEntered, reads, metrics, renders, warnings,
    invalidate(kind) {
      if (kind === 'newer request') app.metricsRequest += 1;
      else if (kind === 'wallet switch') { current = { address:'other-unit-wallet', provider:{} }; app.wallet = current.provider; app.connectedWalletAddress = current.address; }
      else { current = null; app.wallet = null; app.connectedWalletAddress = ''; }
    } };
}
function assertBlocked(f, error) {
  assert.equal(f.app.estimatedLaunchFeeLamports, null);
  assert.equal(f.app.estimatedInitialBuyLamports, 0);
  assert.equal(f.app.estimatedInitialBuyTokens, 0);
  assert.equal(f.app.launchCostReview, null);
  assert.equal(f.app.walletEstimateError, error);
  assert.equal(f.app.launchBurnReadiness.ready, false);
  assert.equal(f.metrics.at(-1).fee, null);
  assert.equal(f.metrics.at(-1).error, error);
}

test('late independent balance and its fetched timestamp survive a held pre-read fee failure', async () => {
  const f = await fixture(); const pending = f.controller.refreshWalletInfo(); await f.feesEntered.promise;
  const independent = f.preview.refreshWalletBalance({ force:true }); await f.balanceEntered.promise;
  f.reads[0].resolve(1250000000); await independent;
  const fetchedAt = f.app.walletBalanceFetchedAt;
  f.fees.reject(Error('503 service fees unavailable')); await pending;
  assert.equal(f.app.walletBalanceLamports, 1250000000); assert.equal(f.app.walletBalanceFetchedAt, fetchedAt);
  assert.equal(f.reads.length, 1); assert.equal('balance' in f.metrics.at(-1), false);
  assertBlocked(f, '503 service fees unavailable'); assert.equal(f.app.launchEstimateRetry.retryable, true);
  assert.equal(f.app.launchEstimateRetry.attempts, 1); assert.ok(f.app.launchEstimateRetry.nextAt > fetchedAt);
});

test('pre-read failure preserves a known zero and genuinely unknown null without refreshing timestamps', async () => {
  for (const balance of [0, null]) {
    const f = await fixture({ balance }); const pending = f.controller.refreshWalletInfo(); await f.feesEntered.promise;
    f.fees.reject(Error('service fees unavailable')); await pending;
    assert.equal(f.app.walletBalanceLamports, balance); assert.equal(f.app.walletBalanceFetchedAt, 12345);
    assert.equal(f.reads.length, 0); assert.equal('balance' in f.metrics.at(-1), false);
    assertBlocked(f, 'service fees unavailable');
  }
});

test('an own balance read rejection clears a previous value to unknown instead of falling back', async () => {
  const f = await fixture({ balance:1250000000 }); const pending = f.controller.refreshWalletInfo(); await f.feesEntered.promise;
  f.fees.resolve({}); await f.balanceEntered.promise; f.reads[0].reject(Error('balance read rejected')); await pending;
  assert.equal(f.app.walletBalanceLamports, null); assert.equal(f.app.walletBalanceFetchedAt, 12345);
  assert.equal(f.metrics.at(-1).balance, null); assertBlocked(f, 'balance read rejected');
});

test('successful own zero and nonzero balances survive a later launch gate failure', async () => {
  for (const value of [0, 2500000000]) {
    const f = await fixture({ balance:777 }); const pending = f.controller.refreshWalletInfo(); await f.feesEntered.promise;
    f.fees.resolve({}); await f.balanceEntered.promise; f.reads[0].resolve(value); await pending;
    assert.equal(f.app.walletBalanceLamports, value); assert.ok(f.app.walletBalanceFetchedAt > 12345);
    assert.equal(f.metrics.at(-1).balance, value); assert.equal(f.reads.length, 1);
    assert.equal(f.reads[0].commitment, 'confirmed'); assertBlocked(f, 'V3 launch is blocked: unavailable.');
  }
});

test('stale pre-read fee failures cannot change current state after newer request, switch or disconnect', async () => {
  for (const kind of ['newer request', 'wallet switch', 'disconnect']) {
    const f = await fixture(); const pending = f.controller.refreshWalletInfo(); await f.feesEntered.promise;
    f.invalidate(kind); Object.assign(f.app, { walletBalanceLamports:900, walletBalanceFetchedAt:54321,
      estimatedLaunchFeeLamports:321, walletEstimateError:'current owner', launchEstimateRetry:{ owner:'current' } });
    const count = f.metrics.length; f.fees.reject(Error('obsolete failure')); await pending;
    assert.equal(f.metrics.length, count); assert.equal(f.app.walletBalanceLamports, 900);
    assert.equal(f.app.walletBalanceFetchedAt, 54321); assert.equal(f.app.estimatedLaunchFeeLamports, 321);
    assert.equal(f.app.walletEstimateError, 'current owner'); assert.equal(f.app.launchEstimateRetry.owner, 'current');
    assert.equal(f.reads.length, 0); assert.equal(f.warnings.length, 0);
  }
});

test('stale own balance success or rejection cannot replace current balance, timestamp, fee or error', async () => {
  for (const kind of ['newer request', 'wallet switch', 'disconnect']) for (const reject of [false, true]) {
    const f = await fixture(); const pending = f.controller.refreshWalletInfo(); await f.feesEntered.promise;
    f.fees.resolve({}); await f.balanceEntered.promise; f.invalidate(kind);
    Object.assign(f.app, { walletBalanceLamports:901, walletBalanceFetchedAt:54322,
      estimatedLaunchFeeLamports:322, walletEstimateError:'new owner' });
    const count = f.metrics.length; if (reject) f.reads[0].reject(Error('obsolete balance')); else f.reads[0].resolve(0);
    await pending; assert.equal(f.metrics.length, count); assert.equal(f.app.walletBalanceLamports, 901);
    assert.equal(f.app.walletBalanceFetchedAt, 54322); assert.equal(f.app.estimatedLaunchFeeLamports, 322);
    assert.equal(f.app.walletEstimateError, 'new owner'); assert.equal(f.warnings.length, 0);
  }
});

test('the unchanged independent loader still clears unknown when its own balance read fails', async () => {
  const f = await fixture({ balance:1250000000 });
  const pending = f.preview.refreshWalletBalance({ force:true }); await f.balanceEntered.promise;
  f.reads[0].reject(Error('independent balance unavailable')); await pending;
  assert.equal(f.app.walletBalanceLamports, null); assert.equal(f.app.walletBalanceFetchedAt, 0);
  assert.equal(f.reads.length, 1); assert.equal(f.metrics.length, 0);
});

if (boundaryChild) {
  assert.equal(process.argv.length, 4);
  assert.equal(typeof SourceTextModule, 'function'); assert.equal(typeof SyntheticModule, 'function');
  assert.ok(selected, 'Unknown FQA073 boundary case');
  await selected.run();
  process.stdout.write(JSON.stringify({ boundary:selected.name, status:'passed' })+'\n');
}
