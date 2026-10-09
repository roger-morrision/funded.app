import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTradeBalances, renderRoundTripAction } from '../src/features/trade/amount-view.js';

function fixture() {
  const fields = new Map(Object.entries({
    '#trade-wallet-balance': { textContent: '' }, '#trade-balance-warning': { hidden: true },
    '#trade-side': { value: 'buy' }, '#trade-amount': { value: '1' }, '#trade-mint': { value: 'coin' },
    '#trade-roundtrip-share': { hidden: true },
  }));
  const sellButton = { disabled: false };
  const document = { querySelector: selector => fields.get(selector), querySelectorAll: () => [sellButton] };
  const state = { wallet: {}, TRADE_FEE_BPS: 100, coinTradeEstimate: { symbol: 'COIN' },
    tradeBalanceState: { key: 'wallet:coin', solLamports: 1_000_000_000n, tokenRaw: 2_000_000n, tokenDecimals: 6 } };
  const callbacks = { document, renderRoundTripAction() {}, tradeBalanceKey: () => 'wallet:coin',
    tradeInputs: () => ({ slippagePercent: 5 }), currentTradePreview: () => null, updateTradeActionState() {} };
  return { fields, sellButton, document, state, callbacks, render: () => renderTradeBalances(state, callbacks) };
}

test('buy balance warning includes fees and slippage, then clears when funded', () => {
  const f = fixture();
  f.render();
  assert.equal(f.fields.get('#trade-wallet-balance').textContent, '1 SOL');
  assert.equal(f.fields.get('#trade-balance-warning').hidden, false);
  f.state.tradeBalanceState.solLamports = 2_000_000_000n;
  f.render();
  assert.equal(f.fields.get('#trade-balance-warning').hidden, true);
});

test('wallet changes hide stale balances and disable percentage sell actions', () => {
  const f = fixture();
  f.fields.get('#trade-side').value = 'sell';
  f.render();
  assert.equal(f.fields.get('#trade-wallet-balance').textContent, '2 COIN');
  assert.equal(f.sellButton.disabled, false);
  f.callbacks.tradeBalanceKey = () => 'another-wallet:coin';
  f.render();
  assert.equal(f.fields.get('#trade-wallet-balance').textContent, 'Checking balance…');
  assert.equal(f.sellButton.disabled, true);
  f.state.wallet = null;
  f.render();
  assert.equal(f.fields.get('#trade-wallet-balance').textContent, 'Connect wallet');
});

test('round-trip sharing requires both receipts for the current wallet and an idle trade', () => {
  const f = fixture();
  let session = { address: 'wallet' };
  const callbacks = { document: f.document, captureWalletSession: () => session,
    savedRoundTrip: (wallet, mint) => wallet === 'wallet' && mint === 'coin' ? { buySignature: 'buy', sellSignature: 'sell' } : null };
  const render = busy => renderRoundTripAction({ tradeActionBusy: busy }, callbacks);
  render(false);
  assert.equal(f.fields.get('#trade-roundtrip-share').hidden, false);
  render(true);
  assert.equal(f.fields.get('#trade-roundtrip-share').hidden, true);
  session = { address: 'other' };
  render(false);
  assert.equal(f.fields.get('#trade-roundtrip-share').hidden, true);
});
