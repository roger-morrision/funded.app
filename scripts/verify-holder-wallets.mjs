import assert from 'node:assert/strict';
import { summarizeHolderWalletSample } from '../holder-wallet-sample.js';

const vault = '1'.repeat(32);
const walletA = '2'.repeat(32);
const walletB = '3'.repeat(32);
const sample = { coverage:'complete-account-list', accounts:[
  { address:vault, wallet:'4'.repeat(32) },
  { address:'5'.repeat(32), wallet:walletA },
  { address:'6'.repeat(32), wallet:walletA },
  { address:'7'.repeat(32), wallet:walletB },
] };
assert.deepEqual(summarizeHolderWalletSample(sample, vault), {
  count:2, coverage:'complete-account-list', sampledAccounts:3,
  topTenHolderPercent:null, devHoldingPercent:null,
});
assert.deepEqual(summarizeHolderWalletSample({ ...sample, coverage:'lower-bound' }, vault), {
  count:2, coverage:'lower-bound', sampledAccounts:3,
  topTenHolderPercent:null, devHoldingPercent:null,
});
assert.deepEqual(summarizeHolderWalletSample({ ...sample, accounts:[...sample.accounts, { address:'8'.repeat(32), wallet:null }] }, vault), {
  count:2, coverage:'lower-bound', sampledAccounts:4,
  topTenHolderPercent:null, devHoldingPercent:null,
});
assert.equal(summarizeHolderWalletSample({ coverage:'lower-bound', accounts:[{ address:'5'.repeat(32), wallet:null }] }, vault), null);
assert.equal(summarizeHolderWalletSample(sample, null), null);
assert.deepEqual(summarizeHolderWalletSample({ coverage:'complete-account-list', accounts:[sample.accounts[0]] }, vault), {
  count:0, coverage:'complete-account-list', sampledAccounts:0,
  topTenHolderPercent:null, devHoldingPercent:null,
});
console.log('Holder wallet sample passed: vault exclusion, unique owners, partial coverage, and unavailable fallback.');
