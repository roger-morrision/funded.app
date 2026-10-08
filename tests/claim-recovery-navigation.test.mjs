import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from);
  return app.slice(from, to);
}

test('an uncertain submitted claim offers a receipt and a status check without another claim action', () => {
  const nodes = [];
  const context = {
    APP_EXPLORER_QUERY: '?cluster=devnet',
    document: {
      createElement: tag => ({ tag, dataset: {} }),
      createTextNode: text => ({ text }),
    },
  };
  vm.runInNewContext(section('function appendPendingCommunityClaim(', 'async function fundCommunityReserve('), context);
  context.appendPendingCommunityClaim({ append: (...items) => nodes.push(...items) }, 'test-mint', 'test-signature');
  const receipt = nodes.find(node => node.tag === 'a');
  assert.equal(receipt.href, 'https://explorer.solana.com/tx/test-signature?cluster=devnet');
  assert.equal(receipt.rel, 'noopener noreferrer');
  const action = nodes.find(node => node.tag === 'button');
  assert.equal(action.textContent, 'Check claim status');
  assert.equal(action.dataset.checkCommunityMint, 'test-mint');
  assert.equal(action.dataset.claimCommunityMint, undefined);
  assert.match(nodes.map(node => node.text || '').join(''), /submitted.*Check its status before trying again/);
});

test('successful launch opens its token, while invalid launch data cannot navigate', () => {
  const visits = [];
  const context = {
    location: { assign: path => visits.push(path) },
    validateSolanaMint: mint => ({ valid: mint === 'verified-mint' }),
  };
  vm.runInNewContext(section('function openLaunchedCoinPage(', 'let airdropRequestInFlight'), context);
  context.openLaunchedCoinPage({ mint: 'verified-mint' });
  assert.deepEqual(visits, ['/token/verified-mint']);
  context.openLaunchedCoinPage({ mint: 'invalid' });
  assert.deepEqual(visits, ['/token/verified-mint']);
});

test('creator claim panel exists and only enables the verified owner above the claim minimum', () => {
  const html = readFile(new URL('../index.html', import.meta.url), 'utf8');
  const button = {};
  const root = { hidden:true, innerHTML:'', replaceChildren() { this.innerHTML=''; button.onclick=null; }, querySelector: () => button };
  let requested = 0;
  const context = {
    document: { querySelector: () => root },
    connectedWalletAddress:'creator', wallet:{ signMessage() {} },
    renderCoinSummary() {}, coinFeeSol: amount => `${amount} lamports`, escapeHtml: value => value,
    requestCreatorFeeClaim: () => { requested++; },
  };
  vm.runInNewContext(section('function renderCoinFeeDashboard(', 'const creatorClaimsInFlight ='), context);
  const overview = { available:true, creatorWallet:'creator', creatorClaim:{ eligible:true, claimableLamports:'10000000', minimumLamports:'10000000' } };
  context.renderCoinFeeDashboard(overview);
  assert.equal(root.hidden, false);
  assert.doesNotMatch(root.innerHTML, /disabled/);
  button.onclick();
  assert.equal(requested, 1);
  context.renderCoinFeeDashboard({...overview, creatorClaim:{...overview.creatorClaim, claimableLamports:'20792'}});
  assert.match(root.innerHTML, /disabled/);
  assert.match(root.innerHTML, /once your creator rewards reach/);
  assert.equal(button.onclick, null);
  context.connectedWalletAddress='other-wallet';
  context.renderCoinFeeDashboard(overview);
  assert.equal(root.hidden, true);
  assert.equal(root.innerHTML, '');
  return html.then(source => assert.match(source, /id="coin-fee-dashboard"/));
});
