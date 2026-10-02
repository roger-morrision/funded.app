import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFullHolderDistribution, summarizeHolderWalletSample } from '../holder-wallet-sample.js';

const vault = 'A'.repeat(32);
const creator = 'B'.repeat(32);
const other = 'C'.repeat(32);
const accounts = [
  { address: vault, wallet: 'D'.repeat(32), amount: '650' },
  { address: 'E'.repeat(32), wallet: creator, amount: '100' },
  { address: 'F'.repeat(32), wallet: creator, amount: '50' },
  { address: 'G'.repeat(32), wallet: other, amount: '200' },
];

test('complete holder accounts aggregate wallets and exclude the pool vault', () => {
  const result = summarizeHolderWalletSample({ accounts, coverage: 'complete-account-list' }, vault,
    { mintSupplyRaw: '1000', creatorWallet: creator });
  assert.equal(result.count, 2);
  assert.equal(result.topTenHolderPercent, 35);
  assert.equal(result.devHoldingPercent, 15);
});

test('a largest-account sample cannot establish exact holder concentration', () => {
  const result = summarizeHolderWalletSample({ accounts, coverage: 'lower-bound' }, vault,
    { mintSupplyRaw: '1000', creatorWallet: creator });
  assert.equal(result.coverage, 'lower-bound');
  assert.equal(result.topTenHolderPercent, null);
  assert.equal(result.devHoldingPercent, null);
});

test('full distribution reconciles supply and combines token accounts by wallet', () => {
  const result = summarizeFullHolderDistribution(accounts, vault, '1000');
  assert.equal(result.accountCount, 4);
  assert.equal(result.walletCount, 2);
  assert.equal(result.vaultShare, 65);
  assert.equal(result.holderShare, 35);
  assert.deepEqual(result.holders.map(row => [row.wallet, row.amountRaw, row.share]),
    [[other, '200', 20], [creator, '150', 15]]);
});

test('incomplete or unverified accounts never appear as a full distribution', () => {
  assert.equal(summarizeFullHolderDistribution(accounts.slice(0, 3), vault, '1000'), null);
  assert.equal(summarizeFullHolderDistribution(accounts.map((row, index) => index === 2 ? { ...row, wallet: null } : row), vault, '1000'), null);
  assert.equal(summarizeFullHolderDistribution([...accounts, accounts[1]], vault, '1100'), null);
});
