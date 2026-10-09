import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppRuntime, initializeAppState } from '../src/app/runtime.js';
import { appStateSchema } from '../src/app/state-schema.js';
import { registerAppControllers } from '../src/app/controllers.js';
import { createFundedTradingController } from '../src/app/controllers/funded-trading.js';

test('runtime preserves lexical initialization, constant bindings and hoisted var values', () => {
  const state = createAppRuntime({ dependency: 42 }, { mutable: 'let', fixed: 'const', early: 'var' });
  assert.throws(() => state.mutable, ReferenceError);
  assert.throws(() => { state.mutable = 1; }, ReferenceError);
  assert.equal(state.early, undefined);
  state.early = 3;
  initializeAppState(state, 'early', 4);
  assert.equal(state.early, 4);
  initializeAppState(state, 'mutable', 1);
  initializeAppState(state, 'fixed', { value: 2 });
  state.mutable++;
  state.fixed.value++;
  assert.equal(state.mutable, 2);
  assert.equal(state.fixed.value, 3);
  assert.throws(() => { state.fixed = {}; }, TypeError);
  assert.throws(() => { state.dependency = 7; }, TypeError);
  assert.throws(() => initializeAppState(state, 'mutable', 3), /already initialized/);
  assert.throws(() => initializeAppState(state, 'missing', 3), /Unknown/);
});

test('registered controllers read current wallet state and isolate application instances', () => {
  function fixture(address) {
    const state = createAppRuntime({ walletAddress: provider => provider.address }, appStateSchema);
    registerAppControllers(state);
    initializeAppState(state, 'wallet', { address, isConnected: true });
    initializeAppState(state, 'connectedWalletAddress', address);
    initializeAppState(state, 'walletVersion', 1);
    return state;
  }
  const first = fixture('first');
  const second = fixture('second');
  const session = first.captureWalletSession();
  assert.ok(first.isWalletSessionCurrent(session));
  assert.equal(second.isWalletSessionCurrent(session), false);
  first.walletVersion++;
  assert.throws(() => first.assertWalletSessionCurrent(session), /Wallet account changed/);
  first.walletVersion--;
  first.wallet = { address: 'first', isConnected: true };
  assert.equal(first.isWalletSessionCurrent(session), false, 'Replacing the provider invalidates captured sessions');
  assert.equal(second.captureWalletSession().address, 'second');
});

test('pool refresh reads live confirmation state after awaiting RPC and preserves an active quote', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const preview = { trade: 'reviewed' };
  const state = {
    APP_CLUSTER: 'devnet', APP_MAINNET_READ_ONLY: false,
    PROTOCOL_FUNDED_MINT: 'mint', PROTOCOL_FUNDED_SWAP_POOL: 'pool',
    fundedBuyBusy: false, fundedBuyPreview: preview, fundedBuyRoute: { status: 'ready', snapshot: 'previous' },
    withRpcRetry: callback => callback(0), getTradePreviewConnection: async () => ({}),
    fetchVerifiedPoolSnapshot: () => pending,
    renderFundedBuyControl: () => assert.fail('Active confirmation must not be overwritten'),
    renderFundedTokenLanding: () => assert.fail('Active confirmation must not be overwritten'),
  };
  const controller = createFundedTradingController(state);
  const refresh = controller.refreshFundedBuyRoute();
  state.fundedBuyBusy = true;
  finish({ pool: 'pool', quoteReservesSol: 1 });
  await refresh;
  assert.equal(state.fundedBuyPreview, preview);
  assert.equal(state.fundedBuyRoute.snapshot, 'previous');
  let rendered = 0;
  state.fundedBuyBusy = false;
  state.renderFundedBuyControl = state.renderFundedTokenLanding = () => rendered++;
  await controller.refreshFundedBuyRoute();
  assert.equal(state.fundedBuyPreview, null);
  assert.equal(state.fundedBuyRoute.snapshot.pool, 'pool');
  assert.equal(rendered, 2);
});
