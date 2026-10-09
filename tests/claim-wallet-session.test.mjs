import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import bs58 from 'bs58';
import { submitSolClaim } from '../src/features/rewards/x-claim-controller.js';

// Run the real handler and real session identity/version checks. Provider and
// HTTP methods are fixtures: no keys, cryptographic signing or chain requests.
const app = await readAppSource();
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from);
  return app.slice(from, to);
}
const source = [
  section('function captureWalletSession(){', 'function wasWalletManuallyDisconnected(){'),
  section('function assertWalletSessionCurrent(session){', 'function resetWalletDependentViews(){'),
].join('\n');
const claimId = 'synthetic-claim';
const receipt = bs58.encode(new Uint8Array(64).fill(7));
const stages = ['identity', 'prepare', 'attest', 'signature', 'verify', 'execute', 'receipt'];

function fixture({ changeAt, change = 'switch', cancelSignature = false, receiptAvailable = true, connected = true, connectSuccess = false, automatic = false } = {}) {
  const calls = [], ui = [], signals = [];
  let changedUiAt = null;
  const key = address => ({ toBase58: () => address });
  const provider = { publicKey: key('original-wallet'), isConnected: true };
  const nodes = {
    '#sol-claim-x-account': { value: '@fixture' },
    '#sol-claim-id': { value: claimId },
    '#claim-binding-agree': { checked: true },
    '#sol-claim-submit': { disabled: false, dataset: {} },
    '#sol-claim-status': { set textContent(text) { ui.push(text); } },
  };
  const context = {
    wallet: connected ? provider : null, connectedWalletAddress: connected ? 'original-wallet' : '', walletVersion: 1,
    walletAddress: wallet => wallet?.publicKey?.toBase58() || '',
    document: { querySelector: selector => nodes[selector] },
    updateClaimBindingReview() {}, emitPilotSignal: value => signals.push(value),
    pilotInterruptedSignal: (_kind, _error, requested) => requested ? 'claim-pending' : 'claim-cancelled',
    showToast: message => ui.push(message),
    syncXClaimFlow: () => { nodes['#sol-claim-submit'].disabled = false; },
    connectWallet: async () => { calls.push('connect'); if (connectSuccess) { context.wallet = provider; context.connectedWalletAddress = 'original-wallet'; } },
    refreshXClaims: async () => { calls.push('refresh'); },
  };
  function complete(stage, value) {
    calls.push(stage);
    if (stage === changeAt) {
      context.walletVersion += 1;
      if (change === 'disconnect') {
        provider.isConnected = false; context.wallet = null; context.connectedWalletAddress = '';
      } else if (change === 'switch') {
        provider.publicKey = key('different-wallet'); context.connectedWalletAddress = 'different-wallet';
      } else {
        assert.equal(change, 'reconnect'); // Same provider/address, new session.
      }
      changedUiAt = ui.length;
    }
    return value;
  }
  provider.signMessage = async message => {
    assert.equal(new TextDecoder().decode(message), 'Synthetic claim statement');
    complete('signature');
    if (cancelSignature) throw new Error('User rejected signing');
    return { signature: new Uint8Array(64).fill(3) };
  };
  context.apiRequest = async (path, options = {}) => {
    if (path === '/api/x/me') return complete('identity', { available: true, data: { authenticated: true, user: { username: 'fixture' } } });
    if (path.endsWith('/prepare')) return complete('prepare', { available: true, data: { statement: 'Synthetic claim statement', boundWallet: null } });
    if (path.endsWith('/attest')) return complete('attest', { available: true, data: { status: 'x-attested-awaiting-wallet' } });
    if (path.endsWith('/verify')) {
      assert.equal(options.body.publicKey, 'original-wallet');
      return complete('verify', { available: true, data: { status: 'ready-to-execute', automaticStatus: automatic ? 'pending' : null } });
    }
    if (path.endsWith('/execute')) return complete('execute', { available: true, data: { signature: receipt } });
    if (path === '/api/x-fee/claims') {
      complete('receipt');
      if (!receiptAvailable) throw new Error('Receipt service unavailable');
      return { available: true, data: { claims: [{ id: claimId, group: 'Paid', receiptVerified: true, payoutSignature: receipt, amountSol: 0.1 }] } };
    }
    assert.fail(`Unexpected fixture request ${path}`);
  };
  vm.runInNewContext(source, context);
  return { run: () => submitSolClaim({ ...context, getWallet: () => context.wallet }), calls, ui, signals, nodes, get changedUiAt() { return changedUiAt; } };
}

for (const change of ['switch', 'disconnect', 'reconnect']) {
  for (const stage of stages) test(`${change} during ${stage} stops stale claim actions and feedback`, async () => {
    const f = fixture({ changeAt: stage, change });
    await f.run();
    assert.deepEqual(f.calls, stages.slice(0, stages.indexOf(stage) + 1), 'No next request, signature or refresh after the captured session ends');
    assert.deepEqual(f.ui.slice(f.changedUiAt), [], 'Old work cannot replace the new session’s status or toast');
    assert.equal(f.nodes['#sol-claim-submit'].dataset.processing, undefined);
    assert.equal(f.nodes['#sol-claim-submit'].disabled, false);
  });
}

test('unchanged wallet completes one claim and reports only the matching verified receipt', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.calls, [...stages, 'refresh']);
  assert(f.ui.some(message => message === `Verified payment of 0.1 SOL to original-wallet. Transaction: ${receipt}`));
  assert.deepEqual(f.signals, ['claim-started', 'claim-verified']);
  assert.equal(f.nodes['#sol-claim-submit'].dataset.processing, undefined);
});

test('cancelled wallet connection performs no claim requests or signing', async () => {
  const f = fixture({ connected: false });
  await f.run();
  assert.deepEqual(f.calls, ['connect']);
  assert.deepEqual(f.signals, []);
});

test('a wallet connected during the claim is read from current state before signing', async () => {
  const f = fixture({ connected: false, connectSuccess: true });
  await f.run();
  assert.deepEqual(f.calls, ['connect', ...stages, 'refresh']);
  assert.deepEqual(f.signals, ['claim-started', 'claim-verified']);
});

test('cancelled signing never verifies or executes a payment and releases processing state', async () => {
  const f = fixture({ cancelSignature: true });
  await f.run();
  assert.deepEqual(f.calls, stages.slice(0, 4));
  assert(f.ui.includes('User rejected signing'));
  assert.equal(f.nodes['#sol-claim-submit'].dataset.processing, undefined);
  assert.equal(f.nodes['#sol-claim-submit'].disabled, false);
});

test('unavailable receipt remains pending after one execute without retry or verified-payment copy', async () => {
  const f = fixture({ receiptAvailable: false });
  await f.run();
  assert.deepEqual(f.calls, [...stages, 'refresh']);
  assert(f.ui.some(message => message.includes('verification is pending')));
  assert(!f.ui.some(message => message.startsWith('Verified payment')));
  assert.deepEqual(f.signals, ['claim-started', 'claim-pending']);
});

test('automatic enrollment reports pending delivery without calling manual execute', async () => {
  const f = fixture({ automatic:true });
  await f.run();
  assert.deepEqual(f.calls, [...stages.slice(0, 5), 'refresh']);
  assert(f.ui.some(message => message.includes('Automatic SOL delivery is in progress')));
  assert.deepEqual(f.signals, ['claim-started', 'claim-pending']);
});
