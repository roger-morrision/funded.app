import test from 'node:test';
import assert from 'node:assert/strict';
import {developerLockDisplay,walletDeveloperLocks} from '../src/features/portfolio/developer-lock-display.js';

const lock={verified:true,status:'locked',amount:'34281146476108',decimals:6,unlockAt:1794259686};
test('RCAT escrow amount and saved deadline are exact; a local clock cannot authorize release',()=>{
  const before=developerLockDisplay(lock,(lock.unlockAt-3660)*1000);
  assert.equal(before.amount,'34,281,146.476108');
  assert.equal(before.deadline.toISOString(),'2026-11-09T21:28:06.000Z');
  assert.match(before.timing,/1h 1m remaining/);assert.equal(before.state,'Locked');
  const after=developerLockDisplay(lock,(lock.unlockAt+1)*1000);
  assert.equal(after.state,'Locked');assert.match(after.timing,/Refresh to verify/);
  assert.equal(developerLockDisplay({...lock,status:'claimable'}).state,'Ready to release');
  const auto=developerLockDisplay({...lock,status:'claimable',automaticRelease:{enabled:true,healthy:true}});
  assert.equal(auto.state,'Awaiting automatic transfer');assert.match(auto.timing,/No wallet signature/);
  assert.match(developerLockDisplay({...lock,automaticRelease:{enabled:true}},(lock.unlockAt-60)*1000).timing,/original creator wallet/);
});
test('unverified, missing decimals and released balances never masquerade as spendable holdings',()=>{
  assert.equal(developerLockDisplay({...lock,verified:false}).state,'Verification unavailable');
  assert.equal(developerLockDisplay({...lock,decimals:undefined}).amount,null);
  assert.equal(developerLockDisplay({...lock,unlockAt:NaN}).deadline,null);
  assert.equal(developerLockDisplay({...lock,status:'released'}).state,'Released');
});
test('locked portfolio includes only the connected creator on the selected network',()=>{
  const launch={mint:'mint',creatorWallet:'creator',cluster:'devnet',onchainVerified:true,developerTokenLock:lock};
  const rows=[launch,{...launch,creatorWallet:'other'},{...launch,cluster:'mainnet-beta'},
    {...launch,onchainVerified:false},{...launch,developerTokenLock:{...lock,amount:'0'}}];
  assert.deepEqual(walletDeveloperLocks(rows,'creator','devnet'),[launch]);
  assert.deepEqual(walletDeveloperLocks(rows,'','devnet'),[]);
});
