import assert from 'node:assert/strict';
import test from 'node:test';
import { claimerRate, sortClaimers, claimantWalletLabel } from '../airdrop-claimers-model.js';

test('claim percentage uses each wallet allocation rather than token amount', () => {
  const rows = [
    { wallet:'larger', amount:80, allocation:400 },
    { wallet:'higher-rate', amount:50, allocation:100 },
    { wallet:'unknown-rate', amount:100, allocation:0 },
  ];
  assert.deepEqual(sortClaimers(rows, 'amount').map(row => row.wallet), ['unknown-rate', 'larger', 'higher-rate']);
  assert.deepEqual(sortClaimers(rows, 'rate').map(row => row.wallet), ['higher-rate', 'larger', 'unknown-rate']);
  assert.equal(claimerRate(rows[2]), null);
});

test('private mode shortens the wallet and public mode preserves it', () => {
  const wallet = '11111111111111111111111111111111';
  assert.equal(claimantWalletLabel(wallet, true), '1111…1111');
  assert.equal(claimantWalletLabel(wallet, false), wallet);
});
