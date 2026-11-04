import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCoinCommunityController } from '../src/app/controllers/coin-community.js';

function fakeDocument() {
  const nodes = new Map();
  const description = { id: 'coin-description', after(node) { node.previousElementSibling = description; nodes.set('#' + node.id, node); } };
  nodes.set('#coin-description', description);
  return {
    nodes,
    querySelector: selector => nodes.get(selector) || null,
    createElement: () => ({ hidden: true, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
  };
}

test('coin failure shows one Refresh button right under the failure message', () => {
  const priorDocument = globalThis.document;
  const document = fakeDocument();
  globalThis.document = document;
  try {
    const state = new Proxy({}, { get: (object, key) => key in object ? object[key] : (() => {}) });
    const { renderOnChainUnavailable } = createCoinCommunityController(state);
    renderOnChainUnavailable('429 Too Many Requests');
    const retry = document.nodes.get('#coin-retry');
    assert.ok(retry, 'retry button created');
    assert.equal(retry.hidden, false);
    assert.equal(retry.type, 'button');
    assert.equal(retry.textContent, 'Refresh');
    assert.equal(retry.attributes['aria-label'], undefined, 'distinct name from the header "Refresh token data" icon');
    assert.equal(retry.previousElementSibling, document.nodes.get('#coin-description'));
    renderOnChainUnavailable('timeout');
    assert.equal(document.nodes.get('#coin-retry'), retry, 'reused, not duplicated');
  } finally { globalThis.document = priorDocument; }
});

test('retry hides on reload and runs the same refresh path as the header button', () => {
  const reset = readFileSync(new URL('../src/app/controllers/coin-state.js', import.meta.url), 'utf8');
  assert.match(reset, /function resetCoinSurface\(mintAddress\)\{\s*const retry = document\.querySelector\('#coin-retry'\); if \(retry\) retry\.hidden = true;/);
  const nav = readFileSync(new URL('../src/app/startup/coin-navigation.js', import.meta.url), 'utf8');
  assert.match(nav, /closest\('#coin-refresh, #coin-retry'\)/);
});
