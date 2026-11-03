import test from 'node:test';
import assert from 'node:assert/strict';
import { yourHomeSummary, yourHomeMarkup } from '../src/features/home/your-home.js';

const wallet = 'Wallet1111111111111111111111111111111111111';

test('the personal Home panel stays hidden without a connected wallet', () => {
  assert.equal(yourHomeSummary({ wallet: '' }), null);
  assert.equal(yourHomeMarkup(null), '');
});

test('the personal Home panel counts launches, holdings and trader rank for the wallet', () => {
  const summary = yourHomeSummary({
    wallet,
    assets: [{ address: 'mintA' }, { address: 'mintB' }],
    policies: [{ mint: 'mintA', onchainVerified: true, creatorWallet: wallet }, { mint: 'mintB', onchainVerified: false, creatorWallet: wallet }],
    holdings: { wallet, status: 'ready', accounts: [{ amount: 5 }, { amount: 0 }] },
    traders: [{ wallet: 'other' }, { wallet }],
  });
  assert.deepEqual({ launched: summary.launched, held: summary.held, rank: summary.rank, rankedCount: summary.rankedCount }, { launched: 1, held: 1, rank: 2, rankedCount: 2 });
  const markup = yourHomeMarkup(summary);
  assert.match(markup, /Welcome back, Wall…1111/);
  assert.match(markup, /#2/);
});

test('holdings still loading or for another wallet show as unknown, and an unranked wallet is invited to trade', () => {
  const summary = yourHomeSummary({ wallet, holdings: { wallet: 'other', status: 'ready', accounts: [] } });
  assert.equal(summary.held, null);
  assert.match(yourHomeMarkup(summary), /Not ranked/);
});
