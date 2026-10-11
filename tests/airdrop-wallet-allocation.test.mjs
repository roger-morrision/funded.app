import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { formatTokenBaseUnits } from '../funded-burn.js';

// Exercise the real directory label and proof lookup with a wallet and API fixture.
// No browser wallet, key material, signing, or chain request is involved.
const app = await readAppSource();
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from);
  return app.slice(from, to);
}
const claimsController = await readFile(new URL('../src/app/controllers/community-claims.js', import.meta.url), 'utf8');
const source = [
  section('function captureWalletSession(){', 'function wasWalletManuallyDisconnected(){'),
  section('function directoryWalletAmount(program){', 'function renderAirdropDirectory('),
  claimsController.replace('export function', 'function'),
  `const claims = createCommunityClaimsController(globalThis);
   Object.assign(globalThis, {
     checkCommunityClaim: claims.checkCommunityClaim,
     formatCommunityProofAmount: claims.formatCommunityProofAmount,
   });`,
].join('\n');

function fixture(proofResponse) {
  const program = { id: 'fixture-mint', symbol: 'FCQA', claimActive: true, snapshotHash: 'fixture-snapshot' };
  const provider = { isConnected: true, publicKey: { toBase58: () => 'fixture-wallet' } };
  const statusText = [];
  const status = { append: (...nodes) => statusText.push(...nodes.map(node => node.text ?? node.textContent ?? '')) };
  const panel = { dataset: { mint: program.id } };
  const context = {
    wallet: provider, connectedWalletAddress: 'fixture-wallet', walletVersion: 1,
    communityWalletAllocations: new Map(), communityClaimReview: null,
    walletAddress: wallet => wallet.publicKey.toBase58(),
    getAirdropPrograms: () => [program],
    renderAirdropDirectory() {},
    document: {
      querySelector: selector => selector === '#airdrop-selected-status' ? status : panel,
      createTextNode: text => ({ text }),
      createElement: () => ({ dataset: {}, textContent: '' }),
    },
    apiRequest: async path => {
      assert.match(path, /wallet=fixture-wallet/);
      return typeof proofResponse === 'function' ? proofResponse() : proofResponse;
    },
    getSolana: async () => ({ PublicKey: class { constructor(value) { this.value = value; } } }),
    getTradePreviewConnection: async () => ({ getAccountInfo: async () => ({ data: Uint8Array.from({ length: 45 }, (_, index) => index === 44 ? 6 : 0) }) }),
    formatTokenBaseUnits,
  };
  vm.runInNewContext(source, context);
  return { context, program, provider, statusText };
}

test('connected wallet sees verified allocation after checking the active airdrop', async () => {
  const f = fixture({ available: true, data: { status: 'claimable', mint: 'fixture-mint', recipient: 'fixture-wallet',
    snapshotHash: 'fixture-snapshot', amount: '12345678', index: 0 } });
  assert.equal(f.context.directoryWalletAmount(f.program), 'Check allocation');
  await f.context.checkCommunityClaim(f.program.id);
  assert.equal(f.context.directoryWalletAmount(f.program), '12.3456 FCQA');
  assert.match(f.statusText.join(' '), /Review claim 12\.3456 FCQA/);
  assert.equal(f.context.communityClaimReview.wallet, 'fixture-wallet');
});

test('ineligible and claimed proofs show distinct wallet results', async () => {
  const ineligible = fixture({ available: true, data: { status: 'ineligible', recipient: 'fixture-wallet' } });
  await ineligible.context.checkCommunityClaim(ineligible.program.id);
  assert.equal(ineligible.context.directoryWalletAmount(ineligible.program), 'No allocation');
  const claimed = fixture({ available: true, data: { status: 'claimed', recipient: 'fixture-wallet' } });
  await claimed.context.checkCommunityClaim(claimed.program.id);
  assert.equal(claimed.context.directoryWalletAmount(claimed.program), 'Already claimed');
});

test('disconnected wallet is prompted, while an unavailable proof is never shown as an allocation', async () => {
  const f = fixture({ available: false, data: { error: 'Proof service offline' } });
  f.context.connectedWalletAddress = '';
  assert.equal(f.context.directoryWalletAmount(f.program), 'Connect to check');
  f.context.connectedWalletAddress = 'fixture-wallet';
  await f.context.checkCommunityClaim(f.program.id);
  assert.equal(f.context.directoryWalletAmount(f.program), 'Proof unavailable');
});

test('proof arriving after an account switch cannot populate the new wallet card', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture(() => pending);
  const checking = f.context.checkCommunityClaim(f.program.id);
  assert.equal(f.context.directoryWalletAmount(f.program), 'Checking…');
  f.context.walletVersion++;
  f.context.connectedWalletAddress = 'next-wallet';
  f.context.communityWalletAllocations.clear();
  finish({ available: true, data: { status: 'claimable', mint: 'fixture-mint', recipient: 'fixture-wallet',
    snapshotHash: 'fixture-snapshot', amount: '12345678', index: 0 } });
  await checking;
  assert.equal(f.context.directoryWalletAmount(f.program), 'Check allocation');
  assert.equal(f.context.communityClaimReview, null);
  assert.deepEqual(f.statusText, []);
});
