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
  assert.match(markup, /href="#payments"/);
  assert.match(markup, /Eligibility, claims and confirmed payments/);
  assert.doesNotMatch(markup, /Trade any coin|Earn SOL/);
});

test('holdings for another wallet remain unavailable instead of implying a zero balance', () => {
  const summary = yourHomeSummary({ wallet, holdings: { wallet: 'other', status: 'ready', accounts: [] } });
  assert.equal(summary.held, null);
  assert.match(yourHomeMarkup(summary), /Your holdings<\/span><strong>Unavailable/);
});
