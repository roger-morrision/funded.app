import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuickBuyPresets, saveQuickBuyPresets, resetQuickBuyPresets, DEFAULT_QUICK_BUY, quickBuyLinksMarkup } from '../src/features/trade/quick-buy-presets.js';

const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const esc = value => String(value).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

test('quick buy defaults to 0.5, 1 and 2 SOL', () => {
  assert.deepEqual(readQuickBuyPresets(memory()), DEFAULT_QUICK_BUY);
});

test('saved amounts are tidied, sorted and reused; bad input is rejected', () => {
  const storage = memory();
  assert.deepEqual(saveQuickBuyPresets(['3', '0.25', '1.50'], storage), ['0.25', '1.5', '3']);
  assert.deepEqual(readQuickBuyPresets(storage), ['0.25', '1.5', '3']);
  assert.throws(() => saveQuickBuyPresets(['1', '1', '2'], storage), /different/);
  assert.throws(() => saveQuickBuyPresets(['0', '1', '2'], storage), /between/);
  assert.throws(() => saveQuickBuyPresets(['1', '2'], storage), /three/);
  assert.deepEqual(resetQuickBuyPresets(storage), DEFAULT_QUICK_BUY);
  assert.deepEqual(readQuickBuyPresets(storage), DEFAULT_QUICK_BUY);
});

test('quick buy links carry the amount for the wallet approval flow', () => {
  const html = quickBuyLinksMarkup({ address: 'MintAddress111', symbol: 'DOG' }, esc, ['0.5', '1', '2']);
  assert.equal((html.match(/data-review-amount="/g) || []).length, 3);
  assert.match(html, /data-review-amount="2"[^>]*>|Buy 2 SOL/);
});
