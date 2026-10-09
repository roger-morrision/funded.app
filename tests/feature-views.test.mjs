import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPortfolio } from '../src/features/portfolio/holdings-view.js';
import { renderExploreAssets } from '../src/features/explore/assets-view.js';
import { renderAirdropProgramDetail } from '../src/features/rewards/airdrop-view.js';
import { tabs } from '../src/features/workspace/dom.js';

function documentFixture() {
  const fields = new Map();
  const document = { activeElement: null, querySelector: selector => fields.get(selector) || null };
  document.createElement = () => ({
    dataset: {}, attributes: {}, children: [], events: {}, hidden: false,
    classList: { add() {} }, textContent: '', innerHTML: '',
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.events[name] = callback; },
    focus() { document.activeElement = this; }, scrollIntoView() {},
  });
  return { document, fields, add(selector) { const element = document.createElement('div'); fields.set(selector, element); return element; } };
}

function portfolioFixture() {
  const fixture = documentFixture();
  for (const name of ['holdings-status', 'holding-rows', 'total-value', 'observed-pnl', 'trade-rows', 'trade-note']) fixture.add(`#portfolio-${name}`);
  const state = { connectedWalletAddress: 'wallet-a', portfolioHoldings: {
    wallet: 'wallet-a', status: 'ready', coverage: 'complete', accounts: [{ mint: 'coin-a', quantity: 2, decimals: 6 }],
  }, assets: [{ address: 'coin-a', symbol: 'ALPHA', name: 'Alpha coin', priceUsd: 3 }], exploreScannedCount: 1 };
  const callbacks = { document: fixture.document, portfolioUnitPriceUsd: asset => asset?.priceUsd ?? null, walletDetailTrades: () => [] };
  return { ...fixture, state, render: () => renderPortfolio(state, callbacks) };
}

test('portfolio uses the latest quote and clears balances belonging to a previous wallet', () => {
  const view = portfolioFixture();
  view.render();
  assert.equal(view.fields.get('#portfolio-total-value').textContent, '$6.00');
  assert.match(view.fields.get('#portfolio-holding-rows').innerHTML, /ALPHA/);
  view.state.assets = [{ ...view.state.assets[0], priceUsd: 5 }];
  view.render();
  assert.equal(view.fields.get('#portfolio-total-value').textContent, '$10.00');
  view.state.connectedWalletAddress = 'wallet-b';
  view.render();
  assert.equal(view.fields.get('#portfolio-total-value').textContent, '—');
  assert.doesNotMatch(view.fields.get('#portfolio-holding-rows').innerHTML, /ALPHA/);
  view.state.connectedWalletAddress = null;
  view.render();
  assert.match(view.fields.get('#portfolio-holding-rows').innerHTML, /Connect a wallet/);
});

test('portfolio leaves unpriced holdings unknown and escapes token metadata', () => {
  const view = portfolioFixture();
  view.state.assets = [{ address: 'coin-a', symbol: '<script>bad()</script>', name: 'A & B' }];
  view.render();
  assert.equal(view.fields.get('#portfolio-total-value').textContent, '—');
  const markup = view.fields.get('#portfolio-holding-rows').innerHTML;
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /A &amp; B/);
  assert.doesNotMatch(markup, /<script>/);
});

test('background Explore refresh preserves a focused action', () => {
  const view = documentFixture();
  const grid = view.add('#asset-grid');
  grid.innerHTML = 'Existing focused card';
  view.document.activeElement = {};
  grid.contains = element => element === view.document.activeElement;
  renderExploreAssets({ force: false }, {}, { document: view.document });
  assert.equal(grid.dataset.refreshPending, 'true');
  assert.equal(grid.innerHTML, 'Existing focused card');
});

test('airdrop details distinguish pending funding, open claims, and closed claims', () => {
  for (const state of ['pending', 'open', 'closed']) {
    const view = documentFixture();
    for (const name of ['selected-program', 'claim-unavailable', 'selected-eyebrow', 'selected-title', 'selected-stats', 'selected-status']) view.add(`#airdrop-${name}`);
    const program = { id: 'mint', name: 'Coin', symbol: 'COIN', reservedTokens: 30, allocationPercent: 3,
      creatorWallet: 'creator', vaultVerified: state !== 'pending', claimActive: state === 'open',
      status: state, claimPublished: state !== 'pending', deadline: 'December 1', snapshot: 'snapshot' };
    renderAirdropProgramDetail(program, { connectedWalletAddress: 'holder', wallet: null }, {
      document: view.document, formatTokenAmount: String, formatVerifiedAirdropAmount: value => value ?? '—',
    });
    const status = view.fields.get('#airdrop-selected-status');
    assert.match(status.textContent, state === 'pending' ? /Funding and wallet eligibility must be confirmed/ : state === 'open' ? /claim by December 1/ : /claim window ended December 1/);
    assert.equal(status.children.some(child => child.dataset?.checkCommunityMint === 'mint'), state === 'open');
    assert.equal(view.fields.get('#airdrop-claim-unavailable').hidden, state === 'open');
  }
});

test('workspace tabs preserve keyboard focus and skip unavailable panels', t => {
  const view = documentFixture();
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: view.document });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; });
  const root = view.document.createElement('section'); root.id = 'rewards';
  const entries = ['ready', 'upcoming', 'paid'].map(key => ({ key, label: key, panel: view.document.createElement('section') }));
  const select = tabs(root, entries, 'Rewards');
  select.setAvailable('upcoming', false);
  entries[0].button.focus();
  let prevented = false;
  root.children[0].events.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(root.dataset.activeView, 'paid');
  assert.equal(view.document.activeElement, entries[2].button);
  assert.equal(entries[2].panel.hidden, false);
  assert.equal(entries[2].button.attributes['aria-selected'], 'true');
  assert.equal(entries[0].button.tabIndex, -1);
  select.setAvailable('paid', false);
  assert.equal(root.dataset.activeView, 'ready');
  assert.equal(entries[0].panel.hidden, false);
});
